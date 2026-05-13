const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Memastikan folder services ada
const uploadDir = 'uploads/services';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Memastikan folder vouchers ada (TAMBAHAN UNTUK VOUCHER)
const vouchersDir = 'uploads/vouchers';
if (!fs.existsSync(vouchersDir)) {
  fs.mkdirSync(vouchersDir, { recursive: true });
}

// Storage untuk services (YANG SUDAH ADA)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

// Storage untuk vouchers (TAMBAHAN)
const storageVouchers = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, vouchersDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

// Filter file untuk gambar (TAMBAHAN)
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

// Upload untuk services (YANG SUDAH ADA, dengan limit 5MB)
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: fileFilter
});

// Upload untuk vouchers (TAMBAHAN, dengan limit 10MB)
const uploadVoucher = multer({
  storage: storageVouchers,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: fileFilter
});

// Export kedua konfigurasi (TAMBAHAN)
module.exports = {
  upload,           // Untuk services (5MB)
  uploadVoucher     // Untuk vouchers (10MB)
};