const nodemailer = require('nodemailer');

// Konfigurasi Transport (Gunakan SMTP Anda, misal: Gmail atau Brevo)
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '465'),
    secure: process.env.EMAIL_SECURE === 'true', // Mengonversi string 'true' menjadi boolean
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

/**
 * Fungsi untuk mengirim Email Invoice
 * @param {string} to - Email penerima
 * @param {object} data - Payload lengkap (layanan, customer, properti, dll)
 * @param {boolean} isPaid - Status apakah sudah lunas
 */
const sendInvoiceEmail = async (to, data, isPaid = true) => {
    // Generate baris tabel layanan secara dinamis
    const itemRows = data.layanan.map(item => `
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eeeeee;">${item.nama}</td>
            <td style="padding: 10px; border-bottom: 1px solid #eeeeee; text-align: center;">${item.qty}</td>
            <td style="padding: 10px; border-bottom: 1px solid #eeeeee; text-align: right;">Rp${parseInt(item.hargaSatuan).toLocaleString('id-ID')}</td>
        </tr>
    `).join('');

    const subject = isPaid ? `[LUNAS] Invoice Pesanan #${data.orderId}` : `Invoice Pesanan #${data.orderId}`;

    const htmlContent = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 10px; overflow: hidden;">
        <div style="background-color: #007bff; color: white; padding: 20px; text-align: center;">
            <h2 style="margin: 0;">${data.isAdmin ? 'PESANAN BARU (ADMIN)' : 'INVOICE PEMBAYARAN'}</h2>
            <p style="margin: 5px 0 0 0;">Order ID: #${data.orderId}</p>
        </div>
        
        <div style="padding: 20px;">
            <p>Halo <strong>${data.customer.nama}</strong>,</p>
            <p>Terima kasih. Pembayaran untuk pesanan Anda telah kami terima dan terverifikasi secara otomatis.</p>
            
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            
            <h4 style="color: #007bff;">Rincian Layanan:</h4>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background-color: #f8f9fa;">
                        <th style="padding: 10px; text-align: left;">Layanan</th>
                        <th style="padding: 10px; text-align: center;">Qty</th>
                        <th style="padding: 10px; text-align: right;">Harga</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemRows}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="2" style="padding: 15px 10px; font-weight: bold; text-align: right;">Total Bayar:</td>
                        <td style="padding: 15px 10px; font-weight: bold; text-align: right; color: #28a745; font-size: 1.2em;">${data.pembayaran.total}</td>
                    </tr>
                </tfoot>
            </table>

            <div style="background-color: #fdfdfe; border: 1px solid #d1ecf1; padding: 15px; border-radius: 5px; margin-top: 20px;">
                <h4 style="margin-top: 0; color: #0c5460;">Detail Jadwal & Lokasi:</h4>
                <p style="margin: 5px 0;"><strong>Gedung:</strong> ${data.properti.jenisGedung}</p>
                <p style="margin: 5px 0;"><strong>Jadwal:</strong> ${data.properti.jadwal}</p>
                <p style="margin: 5px 0;"><strong>Alamat:</strong> ${data.properti.alamat}</p>
                <p style="margin: 5px 0;"><strong>Catatan:</strong> ${data.properti.catatan}</p>
            </div>

            <p style="font-size: 0.9em; color: #666; margin-top: 20px;">
                *Petugas kami akan segera meluncur ke lokasi sesuai jadwal yang tertera. Simpan email ini sebagai bukti pembayaran sah.
            </p>
        </div>

        <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 0.8em; color: #888;">
            <p style="margin: 0;">&copy; 2026 Tangerang Sejuk AC. All Rights Reserved.</p>
        </div>
    </div>
    `;

    const mailOptions = {
        from: `TangerangFast <${process.env.EMAIL_USER}>`,
        to: to,
        subject: subject,
        html: htmlContent,
    };

    return transporter.sendMail(mailOptions);
};

module.exports = { sendInvoiceEmail };