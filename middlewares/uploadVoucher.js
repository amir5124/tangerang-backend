const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Gunakan path absolut di dalam container, yang terhubung ke persistent storage
// Pastikan ini sesuai dengan Destination Path di Coolify Anda yaitu /app/uploads
const baseUploadDir = '/app/uploads';
const vouchersDir = path.join(baseUploadDir, 'vouchers'); // File akan disimpan di /app/uploads/vouchers

// Pastikan folder ada
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

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, vouchersDir); // <-- Menyimpan ke persistent storage
    },
    filename: (req, file, cb) => {
        // Prefix dengan 'voucher_' agar mudah diidentifikasi
        const filename = `voucher_${Date.now()}${path.extname(file.originalname)}`;
        cb(null, filename);
    }
});

const uploadVoucher = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: fileFilter
});

module.exports = uploadVoucher;