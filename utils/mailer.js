const nodemailer = require('nodemailer');

// Log awal untuk memastikan environment variable terbaca (Opsional untuk Debugging)
console.log("📨 Melakukan inisialisasi Mailer...");
console.log("📧 SMTP User:", process.env.EMAIL_USER);

// Konfigurasi Transport
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '465'),
    secure: process.env.EMAIL_SECURE === 'true', 
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS, 
    },
    // Menambahkan debug log dari nodemailer sendiri
    debug: true,
    logger: true 
});

/**
 * Fungsi untuk mengirim Link Reset Password
 */
const sendResetPasswordEmail = async (to, fullName, token) => {
    // FORMAT TERBAIK: Mengarahkan ke index.html baru kemudian Hash Routing
    // Ini memaksa Hostinger untuk tidak mencari folder 'reset-password' secara fisik.
    const resetLink = `https://tangerangfast.online/index.html#/reset-password?token=${token}`;
    
    console.log(`🔗 Membuat link reset untuk ${to}: ${resetLink}`);

    const htmlContent = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 10px; overflow: hidden;">
        <div style="background-color: #633594; color: white; padding: 20px; text-align: center;">
            <h2 style="margin: 0; color: white;">Atur Ulang Kata Sandi</h2>
        </div>
        
        <div style="padding: 20px;">
            <p>Halo <strong>${fullName}</strong>,</p>
            <p>Kami menerima permintaan untuk mengatur ulang kata sandi akun TangerangFast Anda. Silakan klik tombol di bawah ini untuk melanjutkan:</p>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="${resetLink}" style="background-color: #633594; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                    Reset Password Sekarang
                </a>
            </div>
            
            <p style="font-size: 0.9em; color: #666;">
                Link ini hanya berlaku selama <strong>1 jam</strong>. Jika Anda tidak merasa melakukan permintaan ini, abaikan saja email ini.
            </p>
            
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            
            <p style="font-size: 0.8em; color: #888;">
                Jika tombol di atas tidak berfungsi, salin dan tempel link berikut di browser Anda:<br>
                <a href="${resetLink}" style="color: #633594; word-break: break-all;">${resetLink}</a>
            </p>
        </div>

        <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 0.8em; color: #888;">
            <p style="margin: 0;">&copy; 2026 TangerangFast. All Rights Reserved.</p>
        </div>
    </div>
    `;

    const mailOptions = {
        from: `"TangerangFast Support" <${process.env.EMAIL_USER}>`,
        to: to,
        subject: "Permintaan Reset Password - TangerangFast",
        html: htmlContent,
    };

    try {
        console.log(`📡 Mencoba mengirim email ke ${to}...`);
        const info = await transporter.sendMail(mailOptions);
        console.log("✅ Email Reset terhasil terkirim!");
        console.log("🆔 Message ID:", info.messageId);
        return info;
    } catch (error) {
        console.error("❌ ERROR NODEMAILER:");
        console.error("- Code:", error.code);
        console.error("- Message:", error.message);
        if (error.response) console.error("- SMTP Response:", error.response);
        throw error;
    }
};

module.exports = { sendResetPasswordEmail };