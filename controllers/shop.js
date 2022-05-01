const fs = require('fs');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_KEY);

const PDFDocument = require('pdfkit');

const Product = require('../models/products');
const Order = require('../models/order');

const ITEMS_PER_PAGE = 2;

exports.getProducts = async (req, res, next) => {
   const page = +req.query.page || 1;

   try {
      const totalItems = await Product.find().countDocuments();

      const products = await Product.find()
         .skip((page - 1) * ITEMS_PER_PAGE)
         .limit(ITEMS_PER_PAGE);

      res.render('shop/product-list', {
         prods: products,
         path: '/products',
         pageTitle: 'All Products',
         currentPage: page,
         hasNextPage: ITEMS_PER_PAGE * page < totalItems,
         hasPreviousPage: page > 1,
         nextPage: page + 1,
         previousPage: page - 1,
         lastPage: Math.ceil(totalItems / ITEMS_PER_PAGE),
      });
   } catch (err) {
      console.log(err);
   }
};

exports.getProduct = async (req, res, next) => {
   const prodId = req.params.productId;

   try {
      const product = await Product.findById(prodId);
      res.render('shop/product-detail', {
         product: product,
         path: '/products',
         pageTitle: product.title,
      });
   } catch (err) {
      console.log(err);
   }
};

exports.getIndex = async (req, res, next) => {
   const page = +req.query.page || 1;

   try {
      const totalItems = await Product.find().countDocuments();

      const products = await Product.find()
         .skip((page - 1) * ITEMS_PER_PAGE)
         .limit(ITEMS_PER_PAGE);

      res.render('shop/index', {
         prods: products,
         path: '/',
         pageTitle: 'Shop',
         currentPage: page,
         hasNextPage: ITEMS_PER_PAGE * page < totalItems,
         hasPreviousPage: page > 1,
         nextPage: page + 1,
         previousPage: page - 1,
         lastPage: Math.ceil(totalItems / ITEMS_PER_PAGE),
      });
   } catch (err) {
      console.log(err);
   }
};

exports.getCart = async (req, res, next) => {
   try {
      const user = await req.user.populate('cart.items.productId');

      const products = user.cart.items;
      res.render('shop/cart', {
         path: '/cart',
         pageTitle: 'Your Cart',
         products: products,
      });
   } catch (err) {
      console.log(err);
   }
};

exports.postCart = async (req, res, next) => {
   const prodId = req.body.productId;

   try {
      const product = await Product.findById(prodId);

      await req.user.addToCart(product);

      res.redirect('/cart');
   } catch (err) {
      console.log(err);
   }
};

exports.postCartDeleteProduct = async (req, res, next) => {
   const prodId = req.body.productId;
   try {
      await req.user.removeFromCart(prodId);

      res.redirect('/cart');
   } catch (err) {
      console.log(err);
   }
};

exports.getCheckoutSuccess = async (req, res, next) => {
   try {
      const user = await req.user.populate('cart.items.productId');
      const products = user.cart.items.map((i) => {
         return { quantity: i.quantity, productData: { ...i.productId._doc } };
      });
      const order = new Order({
         users: {
            email: req.user.email,
            userId: req.user,
         },
         products: products,
      });
      await order.save();

      await req.user.clearCart();

      res.redirect('/orders');
   } catch (err) {
      console.log(err);
   }
};

exports.getOrders = async (req, res, next) => {
   try {
      const orders = await Order.find({ 'user.userId': req.user._id });

      res.render('shop/orders', {
         path: '/orders',
         pageTitle: 'Your Orders',
         orders: orders,
      });
   } catch (err) {
      console.log(err);
   }
};

exports.getInvoice = async (req, res, next) => {
   const orderId = req.params.orderId;

   try {
      const order = await Order.findById(orderId);

      if (!order) {
         return new Error('No order found');
      }
      if (order.users.userId.toString() !== req.user._id.toString()) {
         return new Error('Unauthorized!');
      }
      const invoiceName = 'invoice-' + orderId + '.pdf';
      const invoicePath = path.join('data', 'invoices', invoiceName);

      const pdfDoc = new PDFDocument();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
         'Content-Disposition',
         'inline; filename="' + invoiceName + '"'
      );
      pdfDoc.pipe(fs.createWriteStream(invoicePath));
      pdfDoc.pipe(res);

      pdfDoc.fontSize(26).text('Invoice', {
         underline: true,
      });
      pdfDoc.text('------------');
      let totalPrice = 0;
      order.products.forEach((prod) => {
         totalPrice += prod.quantity * prod.productData.price;
         pdfDoc
            .fontSize(14)
            .text(
               prod.productData.title +
                  '-' +
                  prod.quantity +
                  'x' +
                  '$' +
                  prod.productData.price
            );
      });
      pdfDoc.text('------------');
      pdfDoc.fontSize(20).text('Total Price: $' + totalPrice);

      pdfDoc.end();
   } catch (err) {
      console.log(err);
   }
};

exports.getCheckout = async (req, res, next) => {
   let products;
   let total = 0;

   try {
      const user = await req.user.populate('cart.items.productId');

      products = user.cart.items;
      total = 0;
      products.forEach((p) => {
         total += p.quantity * p.productId.price;
      });

      const session = await stripe.checkout.sessions.create({
         payment_method_types: ['card'],
         line_items: products.map((p) => {
            return {
               name: p.productId.title,
               description: p.productId.description,
               amount: p.productId.price * 100,
               currency: 'usd',
               quantity: p.quantity,
            };
         }),
         success_url:
            req.protocol + '://' + req.get('host') + '/checkout/success', // => http://localhost:3000
         cancel_url:
            req.protocol + '://' + req.get('host') + '/checkout/cancel',
      });

      res.render('shop/checkout', {
         path: '/checkout',
         pageTitle: 'Checkout',
         products: products,
         totalSum: total,
         sessionId: session.id,
      });
   } catch (err) {
      console.log(err);
   }
};
