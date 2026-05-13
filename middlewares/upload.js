const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Memastikan folder services ada
const uploadDir = 'uploads/services';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Memastikan folder vouchers ada
const vouchersDir = 'uploads/vouchers';
if (!fs.existsSync(vouchersDir)) {
  fs.mkdirSync(vouchersDir, { recursive: true });
}

// Filter file untuk gambar
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Hanya file gambar yang diperbolehkan (jpeg, jpg, png, gif, webp)'));
  }
};

// Storage untuk services
const storageServices = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

// Storage untuk vouchers
const storageVouchers = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, vouchersDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

// Upload untuk services (5MB)
const uploadServices = multer({
  storage: storageServices,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: fileFilter
});

// Upload untuk vouchers (10MB)
const uploadVouchers = multer({
  storage: storageVouchers,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: fileFilter
});

// Export sebagai object dengan method single
module.exports = {
  upload: uploadServices,
  uploadVoucher: uploadVouchers,
  single: (fieldName) => uploadServices.single(fieldName),
  voucherSingle: (fieldName) => uploadVouchers.single(fieldName)
};