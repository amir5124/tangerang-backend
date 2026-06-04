// /app/controllers/mitraController.js
// ============================================================
// Mitra Controller
// ✅ FIX: approveMitra & rejectMitra — notif via sendToUser(user_id)
//         bukan dari users.fcm_token langsung
//         Konsisten dengan notificationService multi-device
// ============================================================

const db = require('../config/db');
const { sendToUser } = require('../services/notificationService');

// ─────────────────────────────────────────────────────────────
// getMitraDashboard
// ─────────────────────────────────────────────────────────────
exports.getMitraDashboard = async (req, res) => {
    const { id } = req.params;
    const LOG = `[getMitraDashboard][StoreID:${id}]`;

    try {
        console.log(`${LOG} Fetching dashboard...`);

        const statsQuery = `
            SELECT 
                s.store_name,
                s.user_id,
                IFNULL((SELECT balance FROM wallets WHERE user_id = s.user_id LIMIT 1), 0) AS balance,
                IFNULL((
                    SELECT SUM(FLOOR((o2.total_price + IFNULL(o2.discount_amount, 0)) * (IFNULL(s.commission_rate, 70) / 100))) 
                    FROM orders o2 
                    WHERE o2.store_id = s.id AND o2.status = 'completed'
                ), 0) AS revenue,
                (SELECT COUNT(*) FROM orders WHERE store_id = s.id AND status = 'completed') AS completed_jobs,
                (SELECT COUNT(*) FROM orders WHERE store_id = s.id AND status IN ('pending', 'accepted', 'on_the_way', 'working')) AS active_jobs,
                (SELECT COUNT(*) FROM orders WHERE store_id = s.id AND status = 'working' AND proof_image_url IS NOT NULL) AS pending_confirmation,
                IFNULL((SELECT AVG(rating) FROM reviews WHERE store_id = s.id), 0) AS avg_rating,
                (SELECT COUNT(*) FROM reviews WHERE store_id = s.id) AS total_reviews
            FROM stores s
            WHERE s.id = ?
        `;

        const recentOrdersQuery = `
            SELECT 
                o.id, 
                o.total_price,
                o.status,
                o.proof_image_url,
                o.scheduled_date,
                o.scheduled_time,
                u.full_name AS customer_name,
                (SELECT service_name FROM order_items WHERE order_id = o.id LIMIT 1) AS service_name
            FROM orders o
            JOIN users u ON o.customer_id = u.id
            WHERE o.store_id = ? AND o.status != 'unpaid'
            ORDER BY o.order_date DESC
            LIMIT 5
        `;

        const [statsResults] = await db.query(statsQuery, [id]);
        const [ordersResults] = await db.query(recentOrdersQuery, [id]);

        if (statsResults.length === 0) {
            console.log(`${LOG} ⚠️  Mitra tidak ditemukan.`);
            return res.status(404).json({ success: false, message: 'Mitra tidak ditemukan' });
        }

        const stats = statsResults[0];
        console.log(`${LOG} Balance: ${stats.balance}, Active: ${stats.active_jobs}, PendingConf: ${stats.pending_confirmation}`);

        res.json({
            success: true,
            data: {
                store_name: stats.store_name,
                stats: {
                    balance: parseFloat(stats.balance),
                    revenue: parseFloat(stats.revenue),
                    completed_jobs: parseInt(stats.completed_jobs),
                    active_jobs: parseInt(stats.active_jobs),
                    pending_confirmation: parseInt(stats.pending_confirmation),
                    rating: parseFloat(stats.avg_rating).toFixed(1),
                    total_reviews: parseInt(stats.total_reviews),
                },
                recent_orders: ordersResults,
            },
        });

    } catch (err) {
        console.error(`${LOG} ❌ Error: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// getAllHistory
// ─────────────────────────────────────────────────────────────
exports.getAllHistory = async (req, res) => {
    const { store_id } = req.params;
    const LOG = `[getAllHistory][StoreID:${store_id}]`;
    let limit = parseInt(req.query.limit);
    if (isNaN(limit) || limit <= 0) limit = 100;

    try {
        const [orders] = await db.query(`
            SELECT 
                o.id, 
                u.full_name AS customer_name, 
                (SELECT service_name FROM order_items WHERE order_id = o.id LIMIT 1) AS service_name, 
                o.total_price, 
                o.status, 
                o.proof_image_url,
                o.scheduled_date, 
                o.scheduled_time,
                o.items,
                o.updated_at,
                o.order_date AS created_at,
                CASE WHEN o.items IS NOT NULL THEN JSON_LENGTH(o.items) ELSE 1 END AS total_items
            FROM orders o
            JOIN users u ON o.customer_id = u.id
            WHERE o.store_id = ? 
            ORDER BY o.order_date DESC 
            LIMIT ?
        `, [parseInt(store_id), limit]);

        console.log(`${LOG} Mengembalikan ${orders.length} order.`);
        return res.status(200).json({ success: true, data: orders });

    } catch (error) {
        console.error(`${LOG} ❌ Error: ${error.message}`);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────
// getStoreProfile
// ─────────────────────────────────────────────────────────────
exports.getStoreProfile = async (req, res) => {
    const { id } = req.params;
    try {
        const [results] = await db.query('SELECT * FROM stores WHERE id = ?', [id]);
        if (results.length === 0) {
            return res.status(404).json({ message: 'Toko tidak ditemukan' });
        }
        res.json(results[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// updateStoreProfile
// ─────────────────────────────────────────────────────────────
exports.updateStoreProfile = async (req, res) => {
    const { id } = req.params;
    const {
        store_name, identity_number, category, address,
        latitude, longitude, bank_name, bank_account_number,
        operating_hours, description,
    } = req.body;

    try {
        const [existing] = await db.query('SELECT store_logo_url FROM stores WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ message: 'Mitra tidak ditemukan' });
        }

        let finalLogoUrl = existing[0].store_logo_url;
        if (req.file) {
            finalLogoUrl = `/uploads/${req.file.filename}`;
        }

        await db.query(
            `UPDATE stores SET 
                store_name=?, identity_number=?, category=?, address=?, 
                latitude=?, longitude=?, bank_name=?, bank_account_number=?, 
                operating_hours=?, description=?, store_logo_url=?
             WHERE id=?`,
            [store_name, identity_number, category, address,
                latitude, longitude, bank_name, bank_account_number,
                operating_hours, description, finalLogoUrl, id]
        );

        res.json({ success: true, message: 'Profil berhasil diperbarui', logo_url: finalLogoUrl });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// getAllMitra
// ─────────────────────────────────────────────────────────────
exports.getAllMitra = async (req, res) => {
    const { category } = req.query;
    let query = `
        SELECT s.*, GROUP_CONCAT(sv.service_name SEPARATOR ', ') AS services
        FROM stores s
        LEFT JOIN services sv ON s.id = sv.store_id
        WHERE s.is_active = 1
    `;
    const params = [];
    if (category) {
        query += ` AND s.category = ?`;
        params.push(category);
    }
    query += ` GROUP BY s.id`;

    try {
        const [results] = await db.query(query, params);
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// getMitraDetail
// ─────────────────────────────────────────────────────────────
exports.getMitraDetail = async (req, res) => {
    const storeId = req.params.id;
    try {
        const [store] = await db.query('SELECT * FROM stores WHERE id = ?', [storeId]);
        const [services] = await db.query('SELECT * FROM services WHERE store_id = ?', [storeId]);
        if (store.length === 0) {
            return res.status(404).json({ message: 'Mitra tidak ditemukan' });
        }
        res.json({ ...store[0], services });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// updateMitra
// ─────────────────────────────────────────────────────────────
exports.updateMitra = async (req, res) => {
    const { store_name, description, address, is_active } = req.body;
    try {
        await db.query(
            'UPDATE stores SET store_name=?, description=?, address=?, is_active=? WHERE id=?',
            [store_name, description, address, is_active, req.params.id]
        );
        res.json({ message: 'Status mitra diperbarui' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// deleteMitra
// ─────────────────────────────────────────────────────────────
exports.deleteMitra = async (req, res) => {
    const { id } = req.params;
    const LOG = `[deleteMitra][StoreID:${id}]`;
    let connection;

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        console.log(`${LOG} Memulai penghapusan mitra...`);

        const [store] = await connection.query(
            'SELECT id, user_id, store_name FROM stores WHERE id = ?',
            [id]
        );
        if (store.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Mitra tidak ditemukan' });
        }

        const { user_id: userId, store_name: storeName } = store[0];
        console.log(`${LOG} Menghapus: "${storeName}" (user_id: ${userId})`);

        const [deletedOrderItems] = await connection.query(
            'DELETE oi FROM order_items oi INNER JOIN orders o ON oi.order_id = o.id WHERE o.store_id = ?',
            [id]
        );
        console.log(`${LOG} - order_items terhapus: ${deletedOrderItems.affectedRows}`);

        const [deletedOrders] = await connection.query(
            'DELETE FROM orders WHERE store_id = ?', [id]
        );
        console.log(`${LOG} - orders terhapus: ${deletedOrders.affectedRows}`);

        const [deletedReviews] = await connection.query(
            'DELETE FROM reviews WHERE store_id = ?', [id]
        );
        console.log(`${LOG} - reviews terhapus: ${deletedReviews.affectedRows}`);

        const [deletedServices] = await connection.query(
            'DELETE FROM services WHERE store_id = ?', [id]
        );
        console.log(`${LOG} - services terhapus: ${deletedServices.affectedRows}`);

        const [deletedStore] = await connection.query(
            'DELETE FROM stores WHERE id = ?', [id]
        );
        console.log(`${LOG} - store terhapus: ${deletedStore.affectedRows}`);

        if (userId) {
            const [updatedUser] = await connection.query(
                "UPDATE users SET role = 'customer' WHERE id = ? AND role = 'mitra'",
                [userId]
            );
            console.log(`${LOG} - role user diubah ke customer: ${updatedUser.affectedRows} baris`);

            // ✅ Nonaktifkan semua device di user_devices + null fcm_token di users
            await connection.query(
                'UPDATE user_devices SET is_active = 0 WHERE user_id = ?',
                [userId]
            );
            await connection.query(
                'UPDATE users SET fcm_token = NULL WHERE id = ?',
                [userId]
            );
            console.log(`${LOG} - FCM token & user_devices dinolaktifkan untuk UID: ${userId}`);

            const [deletedWallet] = await connection.query(
                'DELETE FROM wallets WHERE user_id = ?', [userId]
            );
            console.log(`${LOG} - wallet terhapus: ${deletedWallet.affectedRows}`);
        }

        await connection.commit();
        console.log(`${LOG} ✅ Mitra "${storeName}" berhasil dihapus.`);

        res.json({
            success: true,
            message: `Mitra "${storeName}" dan semua data terkait berhasil dihapus`,
            data: {
                store_id: id,
                store_name: storeName,
                user_id: userId,
                deleted_items: {
                    order_items: deletedOrderItems.affectedRows,
                    orders: deletedOrders.affectedRows,
                    reviews: deletedReviews.affectedRows,
                    services: deletedServices.affectedRows,
                },
            },
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error(`${LOG} ❌ Error: ${err.message}`);
        console.error(err.stack);
        res.status(500).json({ success: false, error: err.message, message: 'Terjadi kesalahan saat menghapus mitra' });
    } finally {
        if (connection) connection.release();
    }
};

// ─────────────────────────────────────────────────────────────
// approveMitra
// ✅ FIX: Notif via sendToUser(user_id) — bukan fcm_token langsung
//         Otomatis kirim ke semua device aktif mitra
// ─────────────────────────────────────────────────────────────
exports.approveMitra = async (req, res) => {
    const { id } = req.params;
    const LOG = `[approveMitra][StoreID:${id}]`;
    console.log(`${LOG} Memulai approval...`);

    try {
        // ✅ Ambil user_id saja — tidak perlu fcm_token dari sini
        const [storeData] = await db.query(
            `SELECT s.store_name, s.user_id 
             FROM stores s 
             WHERE s.id = ?`,
            [id]
        );

        if (!storeData || storeData.length === 0) {
            console.log(`${LOG} ⚠️  Data mitra tidak ditemukan.`);
            return res.status(404).json({ success: false, message: 'Data Mitra tidak ditemukan' });
        }

        const { store_name, user_id } = storeData[0];
        console.log(`${LOG} Mitra: "${store_name}" (user_id: ${user_id})`);

        const [result] = await db.query(
            `UPDATE stores 
             SET approval_status = 'approved', is_active = 1, rejection_reason = NULL 
             WHERE id = ?`,
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(400).json({ success: false, message: 'Gagal memperbarui status' });
        }

        console.log(`${LOG} ✅ Status approved disimpan ke DB.`);

        // ✅ Kirim notif via sendToUser — ambil token dari user_devices
        console.log(`${LOG} 📤 Kirim notif approval ke user_id: ${user_id}`);
        sendToUser(
            user_id,
            'Selamat! Akun Mitra Disetujui ✅',
            `Halo ${store_name}, pendaftaran Anda telah diterima. Sekarang Anda bisa mulai menerima pesanan!`,
            {
                storeId: String(id),
                type: 'MITRA_APPROVED',
                status: 'approved',
            }
        ).catch((e) => console.error(`${LOG} ❌ sendToUser gagal: ${e.message}`));

        res.json({ success: true, message: `Mitra ${store_name} berhasil disetujui.` });

    } catch (err) {
        console.error(`${LOG} ❌ CRITICAL ERROR: ${err.message}`);
        console.error(err.stack);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// rejectMitra
// ✅ FIX: Notif via sendToUser(user_id) — bukan fcm_token langsung
// ─────────────────────────────────────────────────────────────
exports.rejectMitra = async (req, res) => {
    const { id } = req.params;
    const { rejection_reason } = req.body;
    const LOG = `[rejectMitra][StoreID:${id}]`;
    console.log(`${LOG} Memulai penolakan... Alasan: "${rejection_reason || '-'}"`);

    try {
        // ✅ Ambil user_id saja
        const [storeData] = await db.query(
            `SELECT s.store_name, s.approval_status, s.user_id 
             FROM stores s 
             WHERE s.id = ?`,
            [id]
        );

        if (!storeData || storeData.length === 0) {
            return res.status(404).json({ success: false, message: 'Data Mitra tidak ditemukan' });
        }

        const { store_name, approval_status, user_id } = storeData[0];
        console.log(`${LOG} Mitra: "${store_name}" (user_id: ${user_id}), status saat ini: ${approval_status}`);

        const [result] = await db.query(
            `UPDATE stores 
             SET approval_status = 'rejected', is_active = 0, rejection_reason = ? 
             WHERE id = ?`,
            [rejection_reason || null, id]
        );

        if (result.affectedRows === 0) {
            return res.status(400).json({ success: false, message: 'Gagal memperbarui status' });
        }

        console.log(`${LOG} ✅ Status rejected disimpan ke DB.`);

        // ✅ Kirim notif via sendToUser
        const alasanText = rejection_reason
            ? `Alasan: ${rejection_reason}`
            : 'Silakan hubungi admin untuk informasi lebih lanjut.';

        console.log(`${LOG} 📤 Kirim notif penolakan ke user_id: ${user_id}`);
        sendToUser(
            user_id,
            'Pendaftaran Mitra Ditolak ❌',
            `Halo ${store_name}, pendaftaran Anda ditolak. ${alasanText}`,
            {
                storeId: String(id),
                type: 'MITRA_REJECTED',
                status: 'rejected',
            }
        ).catch((e) => console.error(`${LOG} ❌ sendToUser gagal: ${e.message}`));

        res.json({ success: true, message: `Mitra ${store_name} berhasil ditolak.` });

    } catch (err) {
        console.error(`${LOG} ❌ Error: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// revertRejectedToPending
// ─────────────────────────────────────────────────────────────
exports.revertRejectedToPending = async (req, res) => {
    const { id } = req.params;
    const LOG = `[revertRejectedToPending][StoreID:${id}]`;
    console.log(`${LOG} Memulai revert rejected → pending...`);

    try {
        const [storeData] = await db.query(
            'SELECT store_name, approval_status FROM stores WHERE id = ?',
            [id]
        );
        if (!storeData || storeData.length === 0) {
            return res.status(404).json({ success: false, message: 'Data Mitra tidak ditemukan' });
        }

        const { store_name, approval_status } = storeData[0];
        if (approval_status !== 'rejected') {
            return res.status(400).json({
                success: false,
                message: `Hanya mitra dengan status 'rejected' yang dapat dikembalikan ke pending. Status saat ini: ${approval_status}`,
            });
        }

        const [result] = await db.query(
            `UPDATE stores 
             SET approval_status = 'pending', is_active = 0, rejection_reason = NULL 
             WHERE id = ?`,
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(400).json({ success: false, message: 'Gagal memperbarui status' });
        }

        console.log(`${LOG} ✅ "${store_name}" dikembalikan ke pending.`);
        res.json({
            success: true,
            message: `Mitra ${store_name} berhasil dikembalikan ke status pending. Mitra dapat mengajukan ulang pendaftaran.`,
        });

    } catch (err) {
        console.error(`${LOG} ❌ Error: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// revertApprovedToPending
// ─────────────────────────────────────────────────────────────
exports.revertApprovedToPending = async (req, res) => {
    const { id } = req.params;
    const { rejection_reason } = req.body;
    const LOG = `[revertApprovedToPending][StoreID:${id}]`;
    console.log(`${LOG} Memulai revert approved → pending...`);

    try {
        const [storeData] = await db.query(
            'SELECT store_name, approval_status FROM stores WHERE id = ?',
            [id]
        );
        if (!storeData || storeData.length === 0) {
            return res.status(404).json({ success: false, message: 'Data Mitra tidak ditemukan' });
        }

        const { store_name, approval_status } = storeData[0];
        if (approval_status !== 'approved') {
            return res.status(400).json({
                success: false,
                message: `Hanya mitra dengan status 'approved' yang dapat dikembalikan ke pending. Status saat ini: ${approval_status}`,
            });
        }

        const [result] = await db.query(
            `UPDATE stores 
             SET approval_status = 'pending', is_active = 0, rejection_reason = ? 
             WHERE id = ?`,
            [rejection_reason || 'Verifikasi ulang oleh admin', id]
        );

        if (result.affectedRows === 0) {
            return res.status(400).json({ success: false, message: 'Gagal memperbarui status' });
        }

        console.log(`${LOG} ✅ "${store_name}" dikembalikan ke pending untuk verifikasi ulang.`);
        res.json({
            success: true,
            message: `Mitra ${store_name} berhasil dikembalikan ke status pending untuk verifikasi ulang.`,
        });

    } catch (err) {
        console.error(`${LOG} ❌ Error: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// updateCommission
// ─────────────────────────────────────────────────────────────
exports.updateCommission = async (req, res) => {
    const { id } = req.params;
    const { commission_rate } = req.body;
    const LOG = `[updateCommission][StoreID:${id}]`;

    if (commission_rate === undefined || commission_rate === null) {
        return res.status(400).json({ success: false, message: 'commission_rate wajib diisi.' });
    }

    const rate = parseFloat(commission_rate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
        return res.status(400).json({ success: false, message: 'commission_rate harus antara 0 dan 100.' });
    }

    try {
        const [store] = await db.query('SELECT id, store_name FROM stores WHERE id = ?', [id]);
        if (store.length === 0) {
            return res.status(404).json({ success: false, message: 'Mitra tidak ditemukan.' });
        }

        await db.query('UPDATE stores SET commission_rate = ? WHERE id = ?', [rate, id]);

        console.log(`${LOG} ✅ Komisi "${store[0].store_name}" diperbarui ke ${rate}%.`);
        return res.status(200).json({
            success: true,
            message: `Komisi ${store[0].store_name} berhasil diperbarui menjadi ${rate}%.`,
            data: { store_id: id, commission_rate: rate },
        });
    } catch (err) {
        console.error(`${LOG} ❌ Error: ${err.message}`);
        return res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// getAllUsersWithMitraStatus
// ─────────────────────────────────────────────────────────────
exports.getAllUsersWithMitraStatus = async (req, res) => {
    try {
        const [users] = await db.query(`
            SELECT 
                u.id, u.full_name, u.email, u.phone_number, u.role,
                s.id AS store_id, s.store_name, s.approval_status AS store_status,
                s.commission_rate, s.rejection_reason, s.created_at AS store_created_at
            FROM users u
            LEFT JOIN stores s ON u.id = s.user_id
            ORDER BY u.created_at DESC
        `);

        const processedUsers = users.map((user) => {
            if (user.role === 'mitra' && !user.store_id) {
                return {
                    ...user,
                    store_status: 'pending_registration',
                    store_name: user.full_name || 'Belum mengisi data toko',
                };
            }
            return user;
        });

        res.json({ success: true, data: processedUsers });
    } catch (error) {
        console.error('[getAllUsersWithMitraStatus] ❌ Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ─────────────────────────────────────────────────────────────
// rejectMitraUser
// ─────────────────────────────────────────────────────────────
exports.rejectMitraUser = async (req, res) => {
    const { id } = req.params;
    const LOG = `[rejectMitraUser][UserID:${id}]`;
    try {
        const [result] = await db.query(
            "UPDATE users SET role = 'customer', updated_at = NOW() WHERE id = ? AND role = 'mitra'",
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'User tidak ditemukan atau bukan mitra' });
        }

        console.log(`${LOG} ✅ Role diubah ke customer.`);
        res.json({ success: true, message: 'Pendaftaran mitra ditolak' });
    } catch (error) {
        console.error(`${LOG} ❌ Error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ─────────────────────────────────────────────────────────────
// createStoreFromUser
// ─────────────────────────────────────────────────────────────
exports.createStoreFromUser = async (req, res) => {
    const { user_id, store_name, category, description, address, latitude, longitude, approval_status } = req.body;
    const LOG = `[createStoreFromUser][UserID:${user_id}]`;

    try {
        const [existing] = await db.query('SELECT id FROM stores WHERE user_id = ?', [user_id]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'User sudah memiliki toko' });
        }

        const [result] = await db.query(
            `INSERT INTO stores (user_id, store_name, category, description, address, latitude, longitude, approval_status, is_active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
            [user_id, store_name, category || 'pending', description || '', address || '',
                latitude || 0, longitude || 0, approval_status || 'pending']
        );

        console.log(`${LOG} ✅ Store baru dibuat, ID: ${result.insertId}`);
        res.json({ success: true, message: 'Store berhasil dibuat', data: { store_id: result.insertId } });
    } catch (error) {
        console.error(`${LOG} ❌ Error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ─────────────────────────────────────────────────────────────
// approveMitraUser
// ✅ FIX: Notif via sendToUser(user_id) — bukan fcm_token langsung
// ─────────────────────────────────────────────────────────────
exports.approveMitraUser = async (req, res) => {
    const { id } = req.params;
    const { store_name, category } = req.body;
    const LOG = `[approveMitraUser][UserID:${id}]`;
    console.log(`${LOG} Memulai approval user mitra...`);

    try {
        const [user] = await db.query(
            "SELECT id, full_name FROM users WHERE id = ? AND role = 'mitra'",
            [id]
        );
        if (user.length === 0) {
            return res.status(404).json({ success: false, message: 'User mitra tidak ditemukan' });
        }

        const [existingStore] = await db.query('SELECT id FROM stores WHERE user_id = ?', [id]);

        let storeId;
        if (existingStore.length > 0) {
            storeId = existingStore[0].id;
            await db.query(
                `UPDATE stores 
                 SET approval_status = 'approved', is_active = 1,
                     store_name = COALESCE(?, store_name),
                     category   = COALESCE(?, category)
                 WHERE id = ?`,
                [store_name || user[0].full_name, category || 'pending', storeId]
            );
            console.log(`${LOG} ✅ Store existing (ID:${storeId}) diapprove.`);
        } else {
            const [result] = await db.query(
                `INSERT INTO stores (user_id, store_name, category, description, address, latitude, longitude, approval_status, is_active, created_at)
                 VALUES (?, ?, ?, '', '', 0, 0, 'approved', 1, NOW())`,
                [id, store_name || user[0].full_name, category || 'pending']
            );
            storeId = result.insertId;
            console.log(`${LOG} ✅ Store baru dibuat & diapprove (ID:${storeId}).`);
        }

        // ✅ Ambil store_name final dari DB (bukan dari variable lokal yang mungkin null)
        const [finalStore] = await db.query('SELECT store_name FROM stores WHERE id = ?', [storeId]);
        const finalStoreName = finalStore[0]?.store_name ?? store_name ?? user[0].full_name;

        // ✅ Kirim notif via sendToUser(user_id) — bukan fcm_token langsung
        console.log(`${LOG} 📤 Kirim notif approval ke user_id: ${id}`);
        sendToUser(
            id,
            'Selamat! Akun Mitra Disetujui ✅',
            `Halo ${finalStoreName}, pendaftaran Anda telah diterima. Sekarang Anda bisa mulai menerima pesanan!`,
            {
                storeId: String(storeId),
                type: 'MITRA_APPROVED',
                status: 'approved',
            }
        ).catch((e) => console.error(`${LOG} ❌ sendToUser gagal: ${e.message}`));

        res.json({
            success: true,
            message: 'Mitra berhasil disetujui',
            data: { store_id: storeId },
        });

    } catch (error) {
        console.error(`${LOG} ❌ Error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};