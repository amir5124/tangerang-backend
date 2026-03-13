const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/assets/'); // Pastikan folder ini ada
  },
  filename: (req, file, cb) => {
    cb(null, `asset-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage });
module.exports = upload;