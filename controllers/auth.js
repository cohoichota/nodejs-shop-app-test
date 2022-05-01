const crypto = require('crypto');

const bcrypt = require('bcryptjs');

const mailGun = require('mailgun-js');
const DOMAIN = process.env.MAILGUN_DOMAIN;
const mg = mailGun({
   apiKey: process.env.MAILGUN_API_KEY,
   domain: DOMAIN,
});

const { validationResult } = require('express-validator');

const User = require('../models/user');

exports.getLogin = (req, res, next) => {
   let message = req.flash('error');
   if (message.length > 0) {
      message = message[0];
   } else {
      message = null;
   }

   res.render('auth/login', {
      path: '/login',
      pageTitle: 'Login',
      errorMessage: message,
      oldInput: { email: '', password: '' },
      validationErrors: [],
   });
};

exports.getSignup = (req, res, next) => {
   let message = req.flash('error');
   if (message.length > 0) {
      message = message[0];
   } else {
      message = null;
   }

   res.render('auth/signup', {
      path: '/signup',
      pageTitle: 'Signup',
      errorMessage: message,
      oldInput: { email: '', password: '', confirmPassword: '' },
      validationErrors: [],
   });
};

exports.postLogin = async (req, res, next) => {
   const email = req.body.email;
   const password = req.body.password;

   const errors = validationResult(req);
   if (!errors.isEmpty()) {
      return res.status(422).render('auth/login', {
         path: '/login',
         pageTitle: 'Login',
         errorMessage: errors.array()[0].msg,
         oldInput: { email: email, password: password },
         validationErrors: errors.array(),
      });
   }

   try {
      const user = await User.findOne({ email: email });

      if (!user) {
         return res.status(422).render('auth/login', {
            path: '/login',
            pageTitle: 'Login',
            errorMessage: 'Invalid email or password!',
            oldInput: { email: email, password: password },
            validationErrors: [],
         });
      }
      const doMatch = await bcrypt.compare(password, user.password);

      if (doMatch) {
         req.session.isLoggedIn = true;
         req.session.user = user;
         return req.session.save((err) => {
            console.log(err);
            res.redirect('/');
         });
      }
      return res.status(422).render('auth/login', {
         path: '/login',
         pageTitle: 'Login',
         errorMessage: 'Invalid email or password!',
         oldInput: { email: email, password: password },
         validationErrors: [],
      });
   } catch (err) {
      console.log(err);
      return res.status(422).render('auth/login', {
         path: '/login',
         pageTitle: 'Login',
         errorMessage: 'Invalid email or password!',
         oldInput: { email: email, password: password },
         validationErrors: [],
      });
   }
};

exports.postLogout = (req, res, next) => {
   req.session.destroy((err) => {
      console.log(err);
      res.redirect('/');
   });
};

exports.postSignup = async (req, res, next) => {
   const email = req.body.email;
   const password = req.body.password;
   const errors = validationResult(req);
   if (!errors.isEmpty()) {
      console.log(errors.array());
      return res.status(422).render('auth/signup', {
         path: '/signup',
         pageTitle: 'Signup',
         errorMessage: errors.array()[0].msg,
         oldInput: {
            email: email,
            password: password,
            confirmPassword: req.body.confirmPassword,
         },
         validationErrors: errors.array(),
      });
   }

   try {
      const hashedPassword = await bcrypt.hash(password, 12);

      const user = new User({
         email: email,
         password: hashedPassword,
         cart: { items: [] },
      });
      await user.save();

      res.redirect('/login');
      const data = {
         from: 'sender@gmail.com',
         to: process.env.MAILGUN_RECEIVED_EMAIL,
         subject: 'Signup succeeded!',
         text: 'You successfully signed up!',
      };
      mg.messages().send(data, (error, body) => {
         if (error) console.log(error);
         else console.log(body);
      });
   } catch (err) {
      console.log(err);
   }
};

exports.getReset = (req, res, next) => {
   let message = req.flash('error');
   if (message.length > 0) {
      message = message[0];
   } else {
      message = null;
   }

   res.render('auth/reset', {
      path: '/reset',
      pageTitle: 'Reset Password',
      errorMessage: message,
   });
};

exports.postReset = (req, res, next) => {
   crypto.randomBytes(32, (err, buffer) => {
      if (err) {
         console.log(err);
         return res.redirect('/reset');
      }
      const token = buffer.toString('hex');
      User.findOne({ email: req.body.email })
         .then((user) => {
            if (!user) {
               req.flash('error', 'No account with that email found.');
               return res.redirect('/reset');
            }
            user.resetToken = token;
            user.resetTokenExpiration = Date.now() + 3600000;
            return user.save();
         })
         .then((result) => {
            res.redirect('/');
            const data = {
               from: 'sender@gmail.com',
               to: 'cohoichota@gmail.com',
               subject: 'Password Reset',
               html: `
            <p>You requested a password reset</p>
            <p>Click this <a href="http://localhost:3000/reset/${token}">link</a> to set a new password.</p>
            `,
            };
            mg.messages().send(data, (error, body) => {
               if (error) console.log(error);
               else console.log(body);
            });
         })
         .catch((err) => {
            console.log(err);
         });
   });
};

exports.getNewPassword = async (req, res, next) => {
   const token = req.params.token;

   try {
      const user = await User.findOne({
         resetToken: token,
         resetTokenExpiration: { $gt: Date.now() },
      });

      let message = req.flash('error');
      if (message.length > 0) {
         message = message[0];
      } else {
         message = null;
      }

      res.render('auth/new-password', {
         path: '/new-password',
         pageTitle: 'New Password',
         errorMessage: message,
         userId: user._id.toString(),
         passwordToken: token,
      });
   } catch (err) {
      console.log(err);
   }
};

exports.postNewPassword = async (req, res, next) => {
   const newPassword = req.body.password;
   const userId = req.body.userId;
   const passwordToken = req.body.passwordToken;

   let resetUser;

   try {
      const user = await User.findOne({
         resetToken: passwordToken,
         resetTokenExpiration: { $gt: Date.now() },
         _id: userId,
      });

      resetUser = user;
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      resetUser.password = hashedPassword;
      resetUser.resetToken = undefined;
      resetUser.resetTokenExpiration = undefined;
      await resetUser.save();

      res.redirect('/login');
   } catch (err) {
      console.log(user);
   }
};
