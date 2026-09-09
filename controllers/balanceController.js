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

// ============================================================
// ADMIN: Lihat saldo semua user (dengan search & filter role)
// ============================================================
const getAllBalancesAdmin = async (req, res) => {
    try {
        const { search, role } = req.query;
        const connection = await db.getConnection();

        try {
            let sql = `
                SELECT u.id AS user_id, u.full_name, u.email, u.role,
                       w.id AS wallet_id, w.balance, w.updated_at
                FROM users u
                LEFT JOIN wallets w ON w.user_id = u.id
                WHERE 1=1
            `;
            const params = [];

            if (search) {
                sql += ` AND (u.full_name LIKE ? OR u.email LIKE ?)`;
                params.push(`%${search}%`, `%${search}%`);
            }
            if (role) {
                sql += ` AND u.role = ?`;
                params.push(role);
            }

            sql += ` ORDER BY w.balance DESC`;

            const [rows] = await connection.execute(sql, params);

            res.json({ success: true, count: rows.length, data: rows });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error fetching all balances:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data saldo' });
    }
};

// ============================================================
// ADMIN: Cek saldo user spesifik by email
// ============================================================
const getBalanceByEmailAdmin = async (req, res) => {
    try {
        const { email } = req.params;
        const connection = await db.getConnection();

        try {
            const [rows] = await connection.execute(
                `SELECT u.id AS user_id, u.full_name, u.email, u.role,
                        w.id AS wallet_id, w.balance, w.updated_at
                 FROM users u
                 LEFT JOIN wallets w ON w.user_id = u.id
                 WHERE u.email = ?`,
                [email]
            );

            if (rows.length === 0) {
                return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
            }

            const [transactions] = await connection.execute(
                `SELECT amount, type, description, created_at
                 FROM wallet_transactions
                 WHERE wallet_id = ?
                 ORDER BY created_at DESC LIMIT 10`,
                [rows[0].wallet_id]
            );

            res.json({ success: true, data: { ...rows[0], recent_transactions: transactions } });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error fetching balance by email:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data saldo' });
    }
};

module.exports = { getWalletBalance, getAllBalancesAdmin, getBalanceByEmailAdmin };

