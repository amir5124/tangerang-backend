const db = require('../config/db');
const { sendPushNotification } = require('../services/notificationService');
exports.getMitraDashboard = async (req, res) => {
    const { id } = req.params;

    try {
        console.log(`\n[DEBUG] Fetching Dashboard for Store ID: ${id}`);

        const statsQuery = `
        SELECT 
            s.store_name,
            s.user_id,
            -- Saldo nyata di dompet (Uang Cair)
            IFNULL((SELECT balance FROM wallets WHERE user_id = s.user_id LIMIT 1), 0) as balance,
            
            -- Total Pendapatan yang SUDAH CAIR (70% dari order completed)
IFNULL((SELECT SUM(FLOOR((o2.total_price + IFNULL(o2.discount_amount, 0)) * (IFNULL(s.commission_rate, 70) / 100))) 
        FROM orders o2 WHERE o2.store_id = s.id AND o2.status = 'completed'), 0) as revenue,
            
            -- Pekerjaan Selesai (Hanya yang sudah dikonfirmasi Customer)
            (SELECT COUNT(*) FROM orders WHERE store_id = s.id AND status = 'completed') as completed_jobs,
            
            -- PEKERJAAN AKTIF (Sudah bayar & perlu tindakan: Pending, Accepted, OTW, Working)
            (SELECT COUNT(*) FROM orders WHERE store_id = s.id AND status IN ('pending', 'accepted', 'on_the_way', 'working')) as active_jobs,
    
            -- PEKERJAAN MENUNGGU KONFIRMASI (Sudah diupload bukti tapi belum completed)
            (SELECT COUNT(*) FROM orders WHERE store_id = s.id AND status = 'working' AND proof_image_url IS NOT NULL) as pending_confirmation,
            
            IFNULL((SELECT AVG(rating) FROM reviews WHERE store_id = s.id), 0) as avg_rating,
            (SELECT COUNT(*) FROM reviews WHERE store_id = s.id) as total_reviews
        FROM stores s
        WHERE s.id = ?
    `;
        const recentOrdersQuery = `
            SELECT 
                o.id, 
                o.total_price,
                o.status,
                o.proof_image_url, -- PENTING: Agar UI Mitra bisa deteksi status "Menunggu Konfirmasi"
                o.scheduled_date,
                o.scheduled_time,
                u.full_name as customer_name,
                (SELECT service_name FROM order_items WHERE order_id = o.id LIMIT 1) as service_name
            FROM orders o
            JOIN users u ON o.customer_id = u.id
            WHERE o.store_id = ? 
            AND o.status != 'unpaid'
            ORDER BY o.order_date DESC
            LIMIT 5
        `;

        const [statsResults] = await db.query(statsQuery, [id]);
        const [ordersResults] = await db.query(recentOrdersQuery, [id]);

        if (statsResults.length === 0) {
            return res.status(404).json({ success: false, message: "Mitra tidak ditemukan" });
        }

        const stats = statsResults[0];
        console.log(`[DEBUG] Dashboard Stats - Balance: ${stats.balance}, Active: ${stats.active_jobs}, Pending Conf: ${stats.pending_confirmation}`);

        res.json({
            success: true,
            data: {
                store_name: stats.store_name,
                stats: {
                    balance: parseFloat(stats.balance),
                    revenue: parseFloat(stats.revenue),
                    completed_jobs: parseInt(stats.completed_jobs),
                    active_jobs: parseInt(stats.active_jobs),
                    pending_confirmation: parseInt(stats.pending_confirmation), // DATA TAMBAHAN
                    rating: parseFloat(stats.avg_rating).toFixed(1),
                    total_reviews: parseInt(stats.total_reviews)
                },
                recent_orders: ordersResults
            }
        });

    } catch (err) {
        console.error("❌ [Dashboard Error]:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};


exports.getAllHistory = async (req, res) => {
    const { store_id } = req.params;
    let limit = parseInt(req.query.limit);
    if (isNaN(limit) || limit <= 0) limit = 100;

    try {
        const [orders] = await db.query(`
            SELECT 
                o.id, 
                u.full_name AS customer_name, 
                -- Ambil nama layanan dari order_items (Sama dengan logika Dashboard)
                (SELECT service_name FROM order_items WHERE order_id = o.id LIMIT 1) as service_name, 
                o.total_price, 
                o.status, 
                o.proof_image_url,
                o.scheduled_date, 
                o.scheduled_time,
                o.items,
                o.updated_at,
                o.order_date AS created_at,
                CASE 
                    WHEN o.items IS NOT NULL THEN JSON_LENGTH(o.items) 
                    ELSE 1 
                END AS total_items
            FROM orders o
            JOIN users u ON o.customer_id = u.id
            WHERE o.store_id = ? 
            ORDER BY o.order_date DESC 
            LIMIT ?
        `, [parseInt(store_id), limit]);

        return res.status(200).json({
            success: true,
            data: orders
        });
    } catch (error) {
        console.error("❌ Error getAllHistory:", error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getStoreProfile = async (req, res) => {
    const { id } = req.params;
    try {
        const [results] = await db.query("SELECT * FROM stores WHERE id = ?", [id]);
        if (results.length === 0) return res.status(404).json({ message: "Toko tidak ditemukan" });
        res.json(results[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};


exports.updateStoreProfile = async (req, res) => {
    const { id } = req.params;
    const {
        store_name, identity_number, category, address,
        latitude, longitude, bank_name, bank_account_number,
        operating_hours, description
    } = req.body;

    try {
        const [existing] = await db.query("SELECT store_logo_url FROM stores WHERE id = ?", [id]);
        if (existing.length === 0) return res.status(404).json({ message: "Mitra tidak ditemukan" });

        let finalLogoUrl = existing[0].store_logo_url;
        if (req.file) {
            finalLogoUrl = `/uploads/${req.file.filename}`;
        }

        const query = `
            UPDATE stores SET 
                store_name=?, identity_number=?, category=?, address=?, 
                latitude=?, longitude=?, bank_name=?, bank_account_number=?, 
                operating_hours=?, description=?, store_logo_url=?
            WHERE id=?
        `;

        await db.query(query, [
            store_name, identity_number, category, address,
            latitude, longitude, bank_name, bank_account_number,
            operating_hours, description, finalLogoUrl, id
        ]);

        res.json({ success: true, message: "Profil berhasil diperbarui", logo_url: finalLogoUrl });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};


exports.getAllMitra = async (req, res) => {
    const { category } = req.query;
    let query = `
        SELECT s.*, GROUP_CONCAT(sv.service_name SEPARATOR ', ') as services
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


exports.getMitraDetail = async (req, res) => {
    const storeId = req.params.id;
    try {
        const [store] = await db.query("SELECT * FROM stores WHERE id = ?", [storeId]);
        const [services] = await db.query("SELECT * FROM services WHERE store_id = ?", [storeId]);
        if (store.length === 0) return res.status(404).json({ message: "Mitra tidak ditemukan" });
        res.json({ ...store[0], services });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};


exports.updateMitra = async (req, res) => {
    const { store_name, description, address, is_active } = req.body;
    try {
        await db.query(
            "UPDATE stores SET store_name=?, description=?, address=?, is_active=? WHERE id=?",
            [store_name, description, address, is_active, req.params.id]
        );
        res.json({ message: "Status mitra diperbarui" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.deleteMitra = async (req, res) => {
    const { id } = req.params;
    let connection;

    try {
        // Dapatkan koneksi database
        connection = await db.getConnection();

        // Mulai transaction
        await connection.beginTransaction();

        console.log(`[DELETE] Memulai penghapusan mitra dengan ID: ${id}`);

        // 1. Cek apakah mitra ada
        const [store] = await connection.query(
            "SELECT id, user_id, store_name FROM stores WHERE id = ?",
            [id]
        );

        if (store.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Mitra tidak ditemukan"
            });
        }

        const storeData = store[0];
        const userId = storeData.user_id;
        const storeName = storeData.store_name;

        console.log(`[DELETE] Menghapus mitra: ${storeName} (store_id: ${id}, user_id: ${userId})`);

        // 2. Hapus order_items dari orders mitra
        const [deletedOrderItems] = await connection.query(
            "DELETE oi FROM order_items oi INNER JOIN orders o ON oi.order_id = o.id WHERE o.store_id = ?",
            [id]
        );
        console.log(`[DELETE] - order_items terhapus: ${deletedOrderItems.affectedRows}`);

        // 3. Hapus orders mitra
        const [deletedOrders] = await connection.query(
            "DELETE FROM orders WHERE store_id = ?",
            [id]
        );
        console.log(`[DELETE] - orders terhapus: ${deletedOrders.affectedRows}`);

        // 4. Hapus reviews mitra
        const [deletedReviews] = await connection.query(
            "DELETE FROM reviews WHERE store_id = ?",
            [id]
        );
        console.log(`[DELETE] - reviews terhapus: ${deletedReviews.affectedRows}`);

        // 5. Hapus services milik mitra
        const [deletedServices] = await connection.query(
            "DELETE FROM services WHERE store_id = ?",
            [id]
        );
        console.log(`[DELETE] - services terhapus: ${deletedServices.affectedRows}`);

        // 6. Hapus store (mitra) utama
        const [deletedStore] = await connection.query(
            "DELETE FROM stores WHERE id = ?",
            [id]
        );
        console.log(`[DELETE] - store terhapus: ${deletedStore.affectedRows}`);

        // 7. Update role user dari 'mitra' menjadi 'customer' jika user tersebut masih berstatus mitra
        if (userId) {
            const [updatedUser] = await connection.query(
                "UPDATE users SET role = 'customer', updated_at = NOW() WHERE id = ? AND role = 'mitra'",
                [userId]
            );
            console.log(`[DELETE] - user role diubah: ${updatedUser.affectedRows} user`);

            // 8. Hapus token FCM user (opsional, agar tidak dapat notifikasi lagi)
            await connection.query(
                "UPDATE users SET fcm_token = NULL WHERE id = ?",
                [userId]
            );
        }

        // 9. Hapus wallet mitra (jika ada)
        if (userId) {
            const [deletedWallet] = await connection.query(
                "DELETE FROM wallets WHERE user_id = ?",
                [userId]
            );
            console.log(`[DELETE] - wallet terhapus: ${deletedWallet.affectedRows}`);
        }

        // Commit transaction jika semua berhasil
        await connection.commit();

        console.log(`[DELETE] ✅ Mitra ${storeName} (ID: ${id}) berhasil dihapus beserta semua data terkait`);

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
                    services: deletedServices.affectedRows
                }
            }
        });

    } catch (err) {
        // Rollback transaction jika terjadi error
        if (connection) {
            await connection.rollback();
        }

        console.error("❌ [deleteMitra Error]:", err.message);
        console.error("Stack trace:", err.stack);

        res.status(500).json({
            success: false,
            error: err.message,
            message: "Terjadi kesalahan saat menghapus mitra"
        });

    } finally {
        // Release connection kembali ke pool
        if (connection) {
            connection.release();
        }
    }
};

exports.approveMitra = async (req, res) => {
    const { id } = req.params;
    console.log(`DEBUG: Memulai approval mitra dengan ID: ${id}`);

    try {
        const [storeData] = await db.query(`
            SELECT s.store_name, u.fcm_token 
            FROM stores s 
            JOIN users u ON s.user_id = u.id 
            WHERE s.id = ?
        `, [id]);

        console.log("DEBUG: Hasil query storeData:", JSON.stringify(storeData));

        if (!storeData || storeData.length === 0) {
            console.log("DEBUG: Data mitra tidak ditemukan untuk ID:", id);
            return res.status(404).json({ success: false, message: "Data Mitra tidak ditemukan" });
        }

        const { store_name, fcm_token } = storeData[0];
        console.log(`DEBUG: Data ditemukan - Nama Toko: ${store_name}, FCM Token: ${fcm_token ? 'TERSEDIA' : 'KOSONG/NULL'}`);

        const updateQuery = `
            UPDATE stores 
            SET 
                approval_status = 'approved', 
                is_active = 1, 
                rejection_reason = NULL 
            WHERE id = ?
        `;

        const [result] = await db.query(updateQuery, [id]);
        console.log("DEBUG: Hasil update database:", result.affectedRows, "baris terpengaruh");

        if (result.affectedRows === 0) {
            return res.status(400).json({ success: false, message: "Gagal memperbarui status" });
        }

        if (fcm_token && fcm_token.trim() !== "") {
            console.log("DEBUG: Mencoba mengirim notifikasi FCM...");
            try {
                await sendPushNotification(
                    fcm_token,
                    "Selamat! Akun Mitra Disetujui",
                    `Halo ${store_name}, pendaftaran Anda telah diterima. Sekarang Anda bisa mulai menerima pesanan!`,
                    {
                        storeId: String(id),
                        type: "MITRA_APPROVED",
                        status: "approved"
                    }
                );
                console.log(`✅ Notifikasi persetujuan berhasil dikirim ke: ${store_name}`);
            } catch (fcmErr) {
                console.error("⚠️ Gagal mengirim FCM. Detail error:", fcmErr.message);
            }
        } else {
            console.log("DEBUG: Notifikasi dilewati karena FCM Token kosong atau null.");
        }

        res.json({
            success: true,
            message: `Mitra ${store_name} berhasil disetujui.`
        });

    } catch (err) {
        console.error("❌ CRITICAL ERROR [Approve Mitra]:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// Fungsi untuk menolak/mengembalikan mitra ke status pending
exports.rejectMitra = async (req, res) => {
    const { id } = req.params;
    const { rejection_reason } = req.body;

    console.log(`DEBUG: Memulai penolakan mitra dengan ID: ${id}`);

    try {
        // Cek apakah mitra ada
        const [storeData] = await db.query(`
            SELECT s.store_name, s.approval_status, u.fcm_token 
            FROM stores s 
            JOIN users u ON s.user_id = u.id 
            WHERE s.id = ?
        `, [id]);

        if (!storeData || storeData.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Data Mitra tidak ditemukan"
            });
        }

        const { store_name, approval_status, fcm_token } = storeData[0];

        console.log(`DEBUG: Data ditemukan - Nama Toko: ${store_name}, Status Saat Ini: ${approval_status}`);

        // Update status menjadi 'rejected' (kembali ke status pending? Tidak, tetap rejected)
        // Sesuai enum yang ada: 'pending', 'approved', 'rejected'
        // Jika ingin mengembalikan ke pending, gunakan 'pending'
        const updateQuery = `
            UPDATE stores 
            SET 
                approval_status = 'rejected', 
                is_active = 0,
                rejection_reason = ?
            WHERE id = ?
        `;

        const [result] = await db.query(updateQuery, [rejection_reason || null, id]);

        if (result.affectedRows === 0) {
            return res.status(400).json({
                success: false,
                message: "Gagal memperbarui status"
            });
        }

        // Kirim notifikasi ke mitra
        if (fcm_token && fcm_token.trim() !== "") {
            try {
                await sendPushNotification(
                    fcm_token,
                    "Pendaftaran Mitra Ditolak",
                    `Halo ${store_name}, pendaftaran Anda ditolak. ${rejection_reason ? `Alasan: ${rejection_reason}` : 'Silahkan hubungi admin untuk informasi lebih lanjut.'}`,
                    {
                        storeId: String(id),
                        type: "MITRA_REJECTED",
                        status: "rejected"
                    }
                );
                console.log(`✅ Notifikasi penolakan berhasil dikirim ke: ${store_name}`);
            } catch (fcmErr) {
                console.error("⚠️ Gagal mengirim FCM:", fcmErr.message);
            }
        }

        res.json({
            success: true,
            message: `Mitra ${store_name} berhasil ditolak.`
        });

    } catch (err) {
        console.error("❌ ERROR [Reject Mitra]:", err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
};

// Fungsi untuk mengembalikan mitra dari rejected ke pending (agar bisa diajukan ulang)
exports.revertRejectedToPending = async (req, res) => {
    const { id } = req.params;

    console.log(`DEBUG: Mengembalikan mitra ID ${id} dari rejected ke pending`);

    try {
        const [storeData] = await db.query(`
            SELECT store_name, approval_status 
            FROM stores 
            WHERE id = ?
        `, [id]);

        if (!storeData || storeData.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Data Mitra tidak ditemukan"
            });
        }

        const { store_name, approval_status } = storeData[0];

        // Hanya bisa revert jika statusnya 'rejected'
        if (approval_status !== 'rejected') {
            return res.status(400).json({
                success: false,
                message: `Hanya mitra dengan status 'rejected' yang dapat dikembalikan ke pending. Status saat ini: ${approval_status}`
            });
        }

        const updateQuery = `
            UPDATE stores 
            SET 
                approval_status = 'pending', 
                is_active = 0,
                rejection_reason = NULL
            WHERE id = ?
        `;

        const [result] = await db.query(updateQuery, [id]);

        if (result.affectedRows === 0) {
            return res.status(400).json({
                success: false,
                message: "Gagal memperbarui status"
            });
        }

        res.json({
            success: true,
            message: `Mitra ${store_name} berhasil dikembalikan ke status pending. Mitra dapat mengajukan ulang pendaftaran.`
        });

    } catch (err) {
        console.error("❌ ERROR [Revert Rejected to Pending]:", err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
};

// Fungsi untuk mengembalikan mitra dari approved ke pending (jika perlu verifikasi ulang)
exports.revertApprovedToPending = async (req, res) => {
    const { id } = req.params;
    const { rejection_reason } = req.body;

    console.log(`DEBUG: Mengembalikan mitra ID ${id} dari approved ke pending`);

    try {
        const [storeData] = await db.query(`
            SELECT store_name, approval_status 
            FROM stores 
            WHERE id = ?
        `, [id]);

        if (!storeData || storeData.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Data Mitra tidak ditemukan"
            });
        }

        const { store_name, approval_status } = storeData[0];

        // Hanya bisa revert jika statusnya 'approved'
        if (approval_status !== 'approved') {
            return res.status(400).json({
                success: false,
                message: `Hanya mitra dengan status 'approved' yang dapat dikembalikan ke pending. Status saat ini: ${approval_status}`
            });
        }

        const updateQuery = `
            UPDATE stores 
            SET 
                approval_status = 'pending', 
                is_active = 0,
                rejection_reason = ?
            WHERE id = ?
        `;

        const [result] = await db.query(updateQuery, [rejection_reason || 'Verifikasi ulang oleh admin', id]);

        if (result.affectedRows === 0) {
            return res.status(400).json({
                success: false,
                message: "Gagal memperbarui status"
            });
        }

        res.json({
            success: true,
            message: `Mitra ${store_name} berhasil dikembalikan ke status pending untuk verifikasi ulang.`
        });

    } catch (err) {
        console.error("❌ ERROR [Revert Approved to Pending]:", err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
};

// =====================================================
// KOMISI MITRA - Update commission_rate per store
// =====================================================
exports.updateCommission = async (req, res) => {
    const { id } = req.params;
    const { commission_rate } = req.body;

    if (commission_rate === undefined || commission_rate === null) {
        return res.status(400).json({ success: false, message: "commission_rate wajib diisi." });
    }

    const rate = parseFloat(commission_rate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
        return res.status(400).json({ success: false, message: "commission_rate harus antara 0 dan 100." });
    }

    try {
        const [store] = await db.query("SELECT id, store_name FROM stores WHERE id = ?", [id]);
        if (store.length === 0) {
            return res.status(404).json({ success: false, message: "Mitra tidak ditemukan." });
        }

        await db.query(
            "UPDATE stores SET commission_rate = ? WHERE id = ?",
            [rate, id]
        );

        return res.status(200).json({
            success: true,
            message: `Komisi ${store[0].store_name} berhasil diperbarui menjadi ${rate}%.`,
            data: { store_id: id, commission_rate: rate }
        });
    } catch (err) {
        console.error("❌ [updateCommission Error]:", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
};

// =====================================================
// FUNGSI TAMBAHAN UNTUK USER MITRA YANG BELUM MEMILIKI STORE
// =====================================================

exports.getAllUsersWithMitraStatus = async (req, res) => {
    try {
        const query = `
            SELECT 
                u.id,
                u.full_name,
                u.email,
                u.phone_number,
                u.role,
                s.id as store_id,
                s.store_name,
                s.approval_status as store_status,
                s.commission_rate,
                s.rejection_reason,
                s.created_at as store_created_at
            FROM users u
            LEFT JOIN stores s ON u.id = s.user_id
            ORDER BY u.created_at DESC
        `;

        const [users] = await db.query(query);

        const processedUsers = users.map(user => {
            if (user.role === 'mitra' && !user.store_id) {
                return {
                    ...user,
                    store_status: 'pending_registration',
                    store_name: user.full_name || 'Belum mengisi data toko'
                };
            }
            return user;
        });

        res.json({
            success: true,
            data: processedUsers
        });
    } catch (error) {
        console.error("❌ [getAllUsersWithMitraStatus Error]:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.rejectMitraUser = async (req, res) => {
    const { id } = req.params;
    const { rejection_reason } = req.body;

    try {
        const [result] = await db.query(`
            UPDATE users 
            SET role = 'customer', 
                updated_at = NOW()
            WHERE id = ? AND role = 'mitra'
        `, [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "User tidak ditemukan atau bukan mitra"
            });
        }

        res.json({
            success: true,
            message: "Pendaftaran mitra ditolak"
        });
    } catch (error) {
        console.error("❌ [rejectMitraUser Error]:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.createStoreFromUser = async (req, res) => {
    const { user_id, store_name, category, description, address, latitude, longitude, approval_status } = req.body;

    try {
        const [existing] = await db.query("SELECT id FROM stores WHERE user_id = ?", [user_id]);
        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: "User sudah memiliki toko"
            });
        }

        const [result] = await db.query(`
            INSERT INTO stores (
                user_id, store_name, category, description, 
                address, latitude, longitude, approval_status,
                is_active, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())
        `, [user_id, store_name, category || 'pending', description || '', address || '', latitude || 0, longitude || 0, approval_status || 'pending']);

        res.json({
            success: true,
            message: "Store berhasil dibuat",
            data: { store_id: result.insertId }
        });
    } catch (error) {
        console.error("❌ [createStoreFromUser Error]:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.approveMitraUser = async (req, res) => {
    const { id } = req.params;
    const { store_name, category } = req.body;

    try {
        const [user] = await db.query("SELECT id, full_name, email, phone_number FROM users WHERE id = ? AND role = 'mitra'", [id]);

        if (user.length === 0) {
            return res.status(404).json({
                success: false,
                message: "User mitra tidak ditemukan"
            });
        }

        const [existingStore] = await db.query("SELECT id FROM stores WHERE user_id = ?", [id]);

        let storeId;
        if (existingStore.length > 0) {
            storeId = existingStore[0].id;
            await db.query(`
                UPDATE stores 
                SET approval_status = 'approved', 
                    is_active = 1,
                    store_name = COALESCE(?, store_name),
                    category = COALESCE(?, category)
                WHERE id = ?
            `, [store_name || user[0].full_name, category || 'pending', storeId]);
        } else {
            const [result] = await db.query(`
                INSERT INTO stores (
                    user_id, store_name, category, description, 
                    address, latitude, longitude, approval_status,
                    is_active, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', 1, NOW())
            `, [id, store_name || user[0].full_name, category || 'pending', '', '', 0, 0]);
            storeId = result.insertId;
        }

        const [storeData] = await db.query(`
            SELECT s.store_name, u.fcm_token 
            FROM stores s 
            JOIN users u ON s.user_id = u.id 
            WHERE s.id = ?
        `, [storeId]);

        if (storeData.length > 0 && storeData[0].fcm_token && storeData[0].fcm_token.trim() !== "") {
            try {
                await sendPushNotification(
                    storeData[0].fcm_token,
                    "Selamat! Akun Mitra Disetujui",
                    `Halo ${storeData[0].store_name}, pendaftaran Anda telah diterima. Sekarang Anda bisa mulai menerima pesanan!`,
                    {
                        storeId: String(storeId),
                        type: "MITRA_APPROVED",
                        status: "approved"
                    }
                );
            } catch (fcmErr) {
                console.error("⚠️ Gagal mengirim FCM:", fcmErr.message);
            }
        }

        res.json({
            success: true,
            message: "Mitra berhasil disetujui",
            data: { store_id: storeId }
        });
    } catch (error) {
        console.error("❌ [approveMitraUser Error]:,", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};