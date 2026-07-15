// controllers/artPaymentController.js
const db = require('../config/db');
const linkqu = require('../services/linkquService');
const helpers = require('../utils/helpers');
const { sendToUser, sendToRole } = require('../services/notificationService');
const moment = require('moment-timezone');

// ============================================================
// HELPER: Notifikasi ke admin & customer & pekerja
// ============================================================
const notifyArtOrderPaid = async (connection, pesananId) => {
    const tag = `[notifyArtOrderPaid][Pesanan#${pesananId}]`;
    console.log(`${tag} 🔔 ===== MEMULAI PROSES NOTIFIKASI =====`);

    try {
        const [rows] = await connection.execute(
            `SELECT 
                p.id AS pesanan_id,
                p.order_id,
                p.cust_id,
                p.cust_nama,
                p.cust_hp,
                p.worker_id,
                p.worker_nama,
                p.total,
                p.tgl,
                p.jam,
                p.alamat,
                p.catatan,
                p.created_at
             FROM pesanan p
             WHERE p.id = ?`,
            [pesananId]
        );

        if (rows.length === 0) {
            console.warn(`${tag} ⚠️ Pesanan tidak ditemukan di database!`);
            return;
        }

        const pesanan = rows[0];
        console.log(`${tag} ✅ Data pesanan ditemukan:`);
        console.log(`${tag}    📋 order_id    : ${pesanan.order_id}`);
        console.log(`${tag}    👤 cust_nama   : ${pesanan.cust_nama}`);
        console.log(`${tag}    🆔 cust_id     : ${pesanan.cust_id}`);
        console.log(`${tag}    👷 worker_nama : ${pesanan.worker_nama || '(tidak ada)'}`);
        console.log(`${tag}    💰 total       : Rp${parseInt(pesanan.total).toLocaleString('id-ID')}`);

        const totalFormatted = parseInt(pesanan.total).toLocaleString('id-ID');

        // ============================================================
        // 1. Notifikasi ke Admin
        // ============================================================
        console.log(`${tag} 📤 [1/3] Mengirim notifikasi ke ADMIN...`);
        try {
            const adminPayload = {
                orderId: String(pesanan.order_id),
                type: 'ADMIN_ART_ORDER',
                screen: 'ArtOrderDetail',
                pesanan_id: String(pesananId)
            };
            console.log(`${tag}    Payload:`, JSON.stringify(adminPayload, null, 2));

            await sendToRole(
                'admin',
                '🧹 Pesanan ART/Babysitter Baru!',
                `Pesanan #${pesanan.order_id} dari ${pesanan.cust_nama} (${pesanan.cust_hp}) untuk ${pesanan.worker_nama || 'kandidat'} sebesar Rp${totalFormatted}`,
                adminPayload
            );
            console.log(`${tag} ✅ [1/3] Notif Admin BERHASIL terkirim`);
        } catch (err) {
            console.error(`${tag} ❌ [1/3] Notif Admin GAGAL:`, err.message);
            console.error(`${tag}    Stack:`, err.stack);
        }

        // ============================================================
        // 2. Notifikasi ke Customer
        // ============================================================
        console.log(`${tag} 📤 [2/3] Mengirim notifikasi ke CUSTOMER (UID: ${pesanan.cust_id})...`);
        try {
            const customerPayload = {
                orderId: String(pesanan.order_id),
                type: 'ART_PAYMENT_SUCCESS',
                screen: 'ArtMatching',
                pesanan_id: String(pesananId)
            };
            console.log(`${tag}    Payload:`, JSON.stringify(customerPayload, null, 2));

            await sendToUser(
                pesanan.cust_id,
                '✅ Pembayaran Berhasil!',
                `Halo ${pesanan.cust_nama}, pembayaran untuk pesanan ART/Babysitter #${pesanan.order_id} telah berhasil. Tim kami akan segera memproses pencocokan kandidat.`,
                customerPayload
            );
            console.log(`${tag} ✅ [2/3] Notif Customer BERHASIL terkirim ke ${pesanan.cust_id}`);
        } catch (err) {
            console.error(`${tag} ❌ [2/3] Notif Customer GAGAL:`, err.message);
            console.error(`${tag}    Stack:`, err.stack);
        }

        // ============================================================
        // 3. Notifikasi ke Pekerja (jika ada)
        // ============================================================
        if (pesanan.worker_id) {
            console.log(`${tag} 📤 [3/3] Mengirim notifikasi ke PEKERJA (UID: ${pesanan.worker_id})...`);
            try {
                const workerPayload = {
                    orderId: String(pesanan.order_id),
                    type: 'ART_NEW_JOB',
                    screen: 'ArtJobDetail',
                    pesanan_id: String(pesananId)
                };
                console.log(`${tag}    Payload:`, JSON.stringify(workerPayload, null, 2));

                await sendToUser(
                    pesanan.worker_id,
                    '📋 Pesanan Baru untuk Anda!',
                    `Halo ${pesanan.worker_nama}, ada pesanan baru dari ${pesanan.cust_nama} pada ${pesanan.tgl} pukul ${pesanan.jam}.`,
                    workerPayload
                );
                console.log(`${tag} ✅ [3/3] Notif Pekerja BERHASIL terkirim ke ${pesanan.worker_id}`);
            } catch (err) {
                console.error(`${tag} ❌ [3/3] Notif Pekerja GAGAL:`, err.message);
                console.error(`${tag}    Stack:`, err.stack);
            }
        } else {
            console.log(`${tag} ℹ️ [3/3] Tidak ada worker_id, skip notif pekerja`);
        }

        console.log(`${tag} 🎉 ===== PROSES NOTIFIKASI SELESAI =====`);
    } catch (err) {
        console.error(`${tag} ❌❌❌ ERROR FATAL DI notifyArtOrderPaid:`, err.message);
        console.error(`${tag}    Stack:`, err.stack);
    }
};

// ============================================================
// HELPER: Notifikasi saat pesanan dibuat (sebelum bayar)
// ============================================================
const notifyArtOrderCreated = async (cust_id, pesananId, orderId) => {
    console.log(`[notifyArtOrderCreated] 📤 Mengirim notif order dibuat ke customer ${cust_id}...`);
    try {
        const payload = {
            orderId: String(orderId),
            type: 'ART_ORDER_CREATED',
            screen: 'PaymentInstruction',
            pesanan_id: String(pesananId)
        };
        console.log(`[notifyArtOrderCreated]    Payload:`, JSON.stringify(payload, null, 2));

        await sendToUser(
            cust_id,
            '🧾 Pesanan ART Dibuat',
            `Pesanan #${orderId} berhasil dibuat. Selesaikan pembayaran untuk melanjutkan proses matching.`,
            payload
        );
        console.log(`[notifyArtOrderCreated] ✅ Notif ke customer ${cust_id} BERHASIL terkirim`);
    } catch (err) {
        console.error('[notifyArtOrderCreated] ❌ Error:', err.message);
        console.error('[notifyArtOrderCreated]    Stack:', err.stack);
    }
};

// ============================================================
// CREATE PAYMENT untuk ART/Babysitter
// ============================================================
const createArtPayment = async (req, res) => {
    console.log("==========================================");
    console.log("🧹 [ART Payment] Incoming Request");
    console.log("Timestamp:", new Date().toISOString());
    console.log("==========================================");

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const {
            pesanan_id,
            metode_pembayaran,
            total,
            cust_id,
            cust_nama,
            cust_email,
            cust_hp,
            worker_id,
            worker_nama
        } = req.body;

        console.log(`📥 Request body:`);
        console.log(`   pesanan_id        : ${pesanan_id}`);
        console.log(`   metode_pembayaran : ${metode_pembayaran}`);
        console.log(`   total             : ${total}`);
        console.log(`   cust_id           : ${cust_id}`);
        console.log(`   cust_nama         : ${cust_nama}`);
        console.log(`   worker_id         : ${worker_id}`);

        if (!pesanan_id || !metode_pembayaran || !total) {
            return res.status(400).json({
                success: false,
                message: "Data tidak lengkap"
            });
        }

        const isQRIS = metode_pembayaran === 'QRIS';
        const partner_reff = helpers.generatePartnerReff();
        console.log(`🔑 Partner Reff: ${partner_reff}`);

        const duration = isQRIS ? 30 : 1440;
        const expiredMoment = moment().tz('Asia/Jakarta').add(duration, 'minutes');
        const expired = expiredMoment.format('YYYYMMDDHHmmss');
        const formattedExpired = expiredMoment.format('YYYY-MM-DD HH:mm:ss');
        console.log(`⏰ Expired: ${formattedExpired}`);

        const finalEmail = helpers.isValidEmail(cust_email) ? cust_email : process.env.DEFAULT_EMAIL;

        const payload = {
            amount: total,
            partner_reff: partner_reff,
            expired: expired,
            method: metode_pembayaran,
            nama: cust_nama || 'Customer',
            email: finalEmail,
            customer_id: cust_id,
            wa: cust_hp
        };
        console.log(`📤 Payload ke LinkQu:`, JSON.stringify(payload, null, 2));

        const linkquRes = isQRIS ?
            await linkqu.createQRIS(payload) :
            await linkqu.createVA(payload);

        if (!linkquRes.data || linkquRes.data.status !== 'SUCCESS') {
            throw new Error(linkquRes.data?.message || "Gagal mendapatkan respon dari LinkQu");
        }
        console.log(`✅ LinkQu response: SUCCESS`);

        // Ambil order_id dari tabel pesanan
        const [orderData] = await connection.execute(
            `SELECT order_id FROM pesanan WHERE id = ?`,
            [pesanan_id]
        );
        const orderId = orderData[0]?.order_id || `ART-${pesanan_id}`;
        console.log(`📋 Order ID: ${orderId}`);

        // ✅ UPDATE pesanan
        console.log(`📝 Updating pesanan #${pesanan_id}...`);
        await connection.execute(
            `UPDATE pesanan 
             SET 
                metode_bayar = ?,
                total = ?,
                pay_id = ?,
                pay_method = ?,
                pay_status = 'pending',
                pay_data = ?,
                expired_at = ?,
                status = 'pending',
                matching_status = 'pending'
             WHERE id = ?`,
            [
                metode_pembayaran,
                total,
                partner_reff,
                isQRIS ? 'QRIS' : 'VA',
                JSON.stringify(linkquRes.data),
                formattedExpired,
                pesanan_id
            ]
        );
        console.log(`✅ Pesanan #${pesanan_id} updated`);

        await connection.commit();
        console.log(`✅ [ART Payment] Pesanan #${pesanan_id} berhasil dibuat, reff: ${partner_reff}`);

        // 🔥 Kirim notifikasi ke customer bahwa pesanan dibuat (belum bayar)
        await notifyArtOrderCreated(cust_id, pesanan_id, orderId);

        res.json({
            success: true,
            message: 'Pembayaran ART berhasil dibuat',
            data: {
                pesanan_id: pesanan_id,
                order_id: orderId,
                va_number: linkquRes.data.virtual_account || null,
                qris_url: linkquRes.data.imageqris || null,
                expired_at: formattedExpired,
                amount: total,
                partner_reff: partner_reff
            }
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("❌ [ART Payment] Error:", err.message);
        console.error("❌ Stack:", err.stack);
        res.status(500).json({
            success: false,
            message: err.message || "Internal Server Error"
        });
    } finally {
        connection.release();
    }
};

// ============================================================
// WEBHOOK CALLBACK untuk ART Payment
// ============================================================
const handleArtCallback = async (req, res) => {
    const connection = await db.getConnection();
    console.log(`📩 [ART Webhook] ===== WEBHOOK RECEIVED =====`);

    try {
        const { partner_reff, status, amount } = req.body;
        console.log(`📩 [ART Webhook] Reff #${partner_reff} | Status: ${status} | Amount: ${amount}`);

        if (status === 'SUCCESS' || status === 'SETTLED') {
            console.log(`✅ [ART Webhook] Status SUCCESS, memproses...`);
            await connection.beginTransaction();

            console.log(`🔍 [ART Webhook] Mencari pesanan dengan pay_id: ${partner_reff}`);
            const [rows] = await connection.execute(
                `SELECT id, pay_status FROM pesanan WHERE pay_id = ?`,
                [partner_reff]
            );

            console.log(`🔍 [ART Webhook] Hasil query: ${rows.length} row(s) ditemukan`);

            if (rows.length > 0) {
                const pesananId = rows[0].id;
                console.log(`✅ [ART Webhook] Pesanan ditemukan, ID: ${pesananId}, pay_status: ${rows[0].pay_status}`);

                // ✅ Update status
                console.log(`📝 [ART Webhook] Updating pesanan #${pesananId}...`);
                await connection.execute(
                    `UPDATE pesanan 
                     SET pay_status = 'settlement', 
                         status = 'paid',
                         matching_status = 'matching',
                         pay_at = NOW() 
                     WHERE pay_id = ?`,
                    [partner_reff]
                );
                console.log(`✅ [ART Webhook] Pesanan #${pesananId} updated`);

                await connection.commit();
                console.log(`✅ [ART Webhook] Pesanan #${pesananId} lunas. COMMIT success`);

                // 🔥 Kirim notifikasi ke admin, customer, pekerja
                console.log(`📣 [ART Webhook] Memanggil notifyArtOrderPaid untuk pesanan #${pesananId}...`);
                await notifyArtOrderPaid(connection, pesananId);
                console.log(`✅ [ART Webhook] notifyArtOrderPaid selesai`);

                // 🔥 Update response biar frontend tahu ini sukses
                console.log(`📤 [ART Webhook] Sending success response...`);
                res.status(200).json({
                    success: true,
                    message: 'Payment confirmed',
                    pesanan_id: pesananId,
                    status: 'SUCCESS'
                });
                console.log(`✅ [ART Webhook] Response sent`);
                return;
            } else {
                console.log(`⚠️ [ART Webhook] Tidak ada pesanan dengan pay_id: ${partner_reff}`);
                console.log(`⚠️ [ART Webhook] Cek apakah pay_id di database sudah sesuai`);
            }
        } else {
            console.log(`ℹ️ [ART Webhook] Status bukan SUCCESS/SETTLED: ${status}, skip processing`);
        }

        console.log(`📤 [ART Webhook] Sending OK response`);
        res.status(200).send("OK");
    } catch (err) {
        if (connection) await connection.rollback();
        console.error("❌ [ART Webhook] Error:", err.message);
        console.error("❌ [ART Webhook] Stack:", err.stack);
        res.status(500).send("Callback Error");
    } finally {
        connection.release();
        console.log(`📩 [ART Webhook] ===== WEBHOOK FINISHED =====`);
    }
};

// ============================================================
// CHECK PAYMENT STATUS untuk ART
// ============================================================
const checkArtPaymentStatus = async (req, res) => {
    const { partnerReff } = req.params;
    console.log(`🔍 [ART CheckPayment] Checking status for: ${partnerReff}`);

    const connection = await db.getConnection();

    try {
        const [rows] = await connection.execute(
            `SELECT id, pay_status, expired_at, status, matching_status
             FROM pesanan 
             WHERE pay_id = ?`,
            [partnerReff]
        );

        if (rows.length === 0) {
            console.log(`⚠️ [ART CheckPayment] Transaksi tidak ditemukan: ${partnerReff}`);
            return res.status(404).json({
                success: false,
                message: "Transaksi tidak ditemukan"
            });
        }

        const { id: pesananId, pay_status, expired_at, status, matching_status } = rows[0];
        console.log(`📊 [ART CheckPayment] Status: pay_status=${pay_status}, status=${status}, matching_status=${matching_status}`);

        // Cek expired
        if (pay_status === 'pending' && new Date() > new Date(expired_at)) {
            console.log(`⏰ [ART CheckPayment] Transaksi EXPIRED: ${partnerReff}`);
            await connection.beginTransaction();
            await connection.execute(
                `UPDATE pesanan SET pay_status = 'expire', status = 'cancelled', matching_status = 'cancelled' WHERE id = ?`,
                [pesananId]
            );
            await connection.commit();
            return res.json({ success: true, status: 'EXPIRED' });
        }

        // Cek ke LinkQu
        console.log(`🔍 [ART CheckPayment] Checking with LinkQu...`);
        const linkquResult = await linkqu.checkStatus(partnerReff);
        const linkquStatus = linkquResult?.status || linkquResult?.data?.status;
        console.log(`📊 [ART CheckPayment] LinkQu status: ${linkquStatus}`);

        if (linkquStatus === 'SUCCESS' || linkquStatus === 'SETTLED') {
            console.log(`✅ [ART CheckPayment] Payment SUCCESS, updating...`);
            await connection.beginTransaction();
            await connection.execute(
                `UPDATE pesanan SET pay_status = 'settlement', status = 'paid', matching_status = 'matching', pay_at = NOW() WHERE id = ?`,
                [pesananId]
            );
            await connection.commit();
            console.log(`✅ [ART CheckPayment] Pesanan #${pesananId} updated`);

            // 🔥 Kirim notifikasi
            console.log(`📣 [ART CheckPayment] Memanggil notifyArtOrderPaid...`);
            await notifyArtOrderPaid(connection, pesananId);
            console.log(`✅ [ART CheckPayment] notifyArtOrderPaid selesai`);

            return res.json({
                success: true,
                status: 'SUCCESS',
                pesanan_id: pesananId
            });
        }

        res.json({
            success: true,
            status: pay_status.toUpperCase(),
            data: linkquResult
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("[ART CheckPayment] Error:", err.message);
        console.error("[ART CheckPayment] Stack:", err.stack);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    } finally {
        connection.release();
    }
};

// ============================================================
// GET PESANAN BY ID (untuk frontend polling matching)
// ============================================================
const getPesananById = async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [GET Pesanan] Fetching pesanan #${id}`);

    try {
        const [rows] = await db.execute(
            `SELECT * FROM pesanan WHERE id = ? OR order_id = ?`,
            [id, id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Pesanan tidak ditemukan"
            });
        }

        console.log(`✅ [GET Pesanan] Found: ${rows[0].order_id}, status: ${rows[0].status}, matching_status: ${rows[0].matching_status}`);
        res.json({
            success: true,
            data: rows[0]
        });
    } catch (err) {
        console.error("[GET Pesanan] Error:", err.message);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// ============================================================
// UPDATE MATCHING STATUS (untuk admin)
// ============================================================
const updateMatchingStatus = async (req, res) => {
    const { id } = req.params;
    const { matching_status } = req.body;

    console.log(`🔄 [Update Matching] Pesanan #${id} → ${matching_status}`);

    if (!['pending', 'matching', 'approved', 'rejected'].includes(matching_status)) {
        return res.status(400).json({
            success: false,
            message: "Status matching tidak valid"
        });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [rows] = await connection.execute(
            `SELECT id, status FROM pesanan WHERE id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Pesanan tidak ditemukan"
            });
        }

        const currentStatus = rows[0].status;

        // Hanya bisa update matching_status jika status sudah 'paid'
        if (currentStatus !== 'paid' && currentStatus !== 'pending') {
            return res.status(400).json({
                success: false,
                message: "Pesanan tidak dalam status yang tepat untuk matching"
            });
        }

        await connection.execute(
            `UPDATE pesanan 
             SET matching_status = ?,
                 status = CASE 
                     WHEN ? = 'approved' THEN 'approved'
                     WHEN ? = 'rejected' THEN 'rejected'
                     ELSE status
                 END
             WHERE id = ?`,
            [matching_status, matching_status, matching_status, id]
        );

        await connection.commit();

        console.log(`✅ [Update Matching] Pesanan #${id} matching_status → ${matching_status}`);
        res.json({
            success: true,
            message: `Matching status berhasil diupdate menjadi ${matching_status}`,
            data: { id, matching_status }
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("[Update Matching] Error:", err.message);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    } finally {
        connection.release();
    }
};

// ============================================================
// EXPORT MODULE
// ============================================================
module.exports = {
    createArtPayment,
    handleArtCallback,
    checkArtPaymentStatus,
    notifyArtOrderPaid,
    notifyArtOrderCreated,
    getPesananById,
    updateMatchingStatus
};