const db = require('../config/db');

const getWalletBalance = async (req, res) => {
    try {
        // req.user diisi oleh authenticateToken di middleware kamu
        const userId = req.user.id; 
        const connection = await db.getConnection();

        try {
            // Query JOIN untuk memastikan data user dan balance sinkron
            const [rows] = await connection.execute(
                `SELECT w.id AS wallet_id, w.balance, u.full_name, u.role 
                 FROM wallets w 
                 JOIN users u ON w.user_id = u.id 
                 WHERE w.user_id = ?`,
                [userId]
            );

            if (rows.length === 0) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Dompet digital tidak ditemukan.' 
                });
            }

            const wallet = rows[0];

            // Ambil 10 transaksi terakhir dari wallet_transactions
            const [transactions] = await connection.execute(
                `SELECT amount, type, description, created_at 
                 FROM wallet_transactions 
                 WHERE wallet_id = ? 
                 ORDER BY created_at DESC LIMIT 10`,
                [wallet.wallet_id]
            );

            res.json({
                success: true,
                message: "Data saldo berhasil diambil",
                data: {
                    user: {
                        name: wallet.full_name,
                        role: wallet.role
                    },
                    wallet: {
                        balance: wallet.balance,
                        transactions: transactions
                    }
                }
            });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error fetching balance:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data saldo' });
    }
};

module.exports = { getWalletBalance };