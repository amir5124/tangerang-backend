// /app/controllers/orderController.js
// ============================================================
// Order Controller — Final Version
// Fix: double notif admin, logging detail, Expo FCM ready
// Support: Service & Product Orders
// ============================================================

const fs = require('fs');
const db = require('../config/db');
const { sendToUser, sendToRole } = require('../services/notificationService');

const parseCommission = (raw) => {
    const parsed = parseFloat(raw);
    if (isNaN(parsed) || parsed < 0 || parsed > 100) return 70;
    return parseFloat(parsed.toFixed(2));
};

// ─────────────────────────────────────────────
// HELPER: Notifikasi ke semua admin
// Selalu await supaya error terlog dengan jelas
// ─────────────────────────────────────────────
const notifyAdmins = async (title, body, orderId = null) => {
    const tag = `[notifyAdmins][Order#${orderId || '-'}]`;
    console.log(`${tag} 📣 Mengirim notif ke role admin...`);
    console.log(`${tag}    Title : ${title}`);
    console.log(`${tag}    Body  : ${body}`);
    try {
        const dataPayload = {
            type: 'ADMIN_ORDER_ALERT',
            screen: 'OrderDetail',            // hint navigasi di sisi app
            ...(orderId && { orderId: String(orderId) }),
        };
        await sendToRole('admin', title, body, dataPayload);
        console.log(`${tag} ✅ Notif admin selesai`);
    } catch (error) {
        console.error(`${tag} ❌ Gagal kirim notif admin:`, error.message);
    }
};

// ─────────────────────────────────────────────
// releaseFundsToMitra
// ⚠️  TIDAK memanggil notifyAdmins di sini
//     supaya tidak double dengan caller-nya
// ─────────────────────────────────────────────
const releaseFundsToMitra = async (connection, orderId) => {
    const tag = `[releaseFunds][Order#${orderId}]`;
    console.log(`${tag} === Memulai Pencairan Dana ===`);

    // Cegah double pencairan
    const [existingTx] = await connection.execute(
        'SELECT id FROM wallet_transactions WHERE description LIKE ?',
        [`%Order #${orderId}%`]
    );
    if (existingTx.length > 0) {
        console.warn(`${tag} ⚠️  Sudah pernah dicairkan (${existingTx.length} tx). Skip.`);
        return false;
    }

    const [order] = await connection.execute(
        `SELECT 
            o.total_price, 
            o.discount_amount, 
            o.platform_fee, 
            o.service_fee, 
            s.user_id   AS mitra_user_id,
            s.store_name,
            IFNULL(s.commission_rate, 70) AS commission_rate
         FROM orders o 
         JOIN stores s ON o.store_id = s.id 
         WHERE o.id = ?`,
        [orderId]
    );

    if (order.length === 0) {
        console.error(`${tag} ❌ Order tidak ditemukan di DB.`);
        return false;
    }

    const { total_price, discount_amount, mitra_user_id, store_name, commission_rate } = order[0];

    const paidByCustomer = parseFloat(total_price) || 0;
    const discountVal = parseFloat(discount_amount) || 0;
    const commissionPct = parseCommission(commission_rate);
    const grossOriginal = paidByCustomer + discountVal;
    const netAmount = Math.floor(grossOriginal * (commissionPct / 100));
    const appPct = parseFloat((100 - commissionPct).toFixed(2));
    const appProfitKotor = grossOriginal - netAmount;
    const appProfitBersih = paidByCustomer - netAmount;

    console.log(`${tag} 📊 Rincian Dana:`);
    console.log(`${tag}    Toko                 : ${store_name} (UID Mitra: ${mitra_user_id})`);
    console.log(`${tag}    Nilai Jasa Asli       : Rp${grossOriginal.toLocaleString('id-ID')}`);
    console.log(`${tag}    Voucher (beban app)   : Rp${discountVal.toLocaleString('id-ID')}`);
    console.log(`${tag}    Customer Bayar        : Rp${paidByCustomer.toLocaleString('id-ID')}`);
    console.log(`${tag}    Komisi Mitra          : ${commissionPct}%`);
    console.log(`${tag}    Net to Mitra          : Rp${netAmount.toLocaleString('id-ID')}`);
    console.log(`${tag}    Profit App ${appPct}% (kotor) : Rp${appProfitKotor.toLocaleString('id-ID')}`);
    console.log(`${tag}    Profit App (bersih)   : Rp${appProfitBersih.toLocaleString('id-ID')}`);

    // Wallet
    const [walletCheck] = await connection.execute(
        'SELECT id, balance FROM wallets WHERE user_id = ?',
        [mitra_user_id]
    );

    let walletId;
    if (walletCheck.length === 0) {
        console.log(`${tag} 🆕 Wallet belum ada, membuat wallet baru untuk UID: ${mitra_user_id}`);
        const [ins] = await connection.execute(
            'INSERT INTO wallets (user_id, balance) VALUES (?, ?)',
            [mitra_user_id, netAmount]
        );
        walletId = ins.insertId;
        console.log(`${tag} ✅ Wallet baru ID: ${walletId}, saldo awal: Rp${netAmount.toLocaleString('id-ID')}`);
    } else {
        walletId = walletCheck[0].id;
        const saldoLama = parseFloat(walletCheck[0].balance);
        await connection.execute(
            'UPDATE wallets SET balance = balance + ? WHERE user_id = ?',
            [netAmount, mitra_user_id]
        );
        console.log(`${tag} 💳 Wallet ID: ${walletId} | Saldo: Rp${saldoLama.toLocaleString('id-ID')} → Rp${(saldoLama + netAmount).toLocaleString('id-ID')}`);
    }

    // Catat transaksi
    await connection.execute(
        "INSERT INTO wallet_transactions (wallet_id, amount, type, description) VALUES (?, ?, 'credit', ?)",
        [
            walletId,
            netAmount,
            `Penghasilan Order #${orderId} (${commissionPct}% dari nilai jasa Rp${grossOriginal.toLocaleString('id-ID')})`
        ]
    );
    console.log(`${tag} 📝 Transaksi wallet tercatat.`);

    // ✅ TIDAK panggil notifyAdmins di sini
    //    Supaya caller (customerCompleteOrder) yang gabungkan notif
    //    dan menghindari double notifikasi ke admin

    console.log(`${tag} === Pencairan Selesai. Mitra: Rp${netAmount.toLocaleString('id-ID')} ===`);
    return { netAmount, mitra_user_id, store_name };
};

// ============================================================
// createOrder - Untuk Service (AC, Sedot WC, ART, dll)
// ============================================================
// /app/controllers/orderController.js
// ============================================================
// createOrder - Untuk Service (AC, Sedot WC, ART, dll)
// ============================================================
exports.createOrder = async (req, res) => {
    const {
        customer_id, store_id, metode_pembayaran, jenisGedung,
        jadwal, lokasi, rincian_biaya, layananTerpilih, catatan, voucher_code
    } = req.body;

    const tag = '[createOrder]';
    console.log(`${tag} === Incoming Service Order ===`);
    console.log(`${tag}    Customer ID : ${customer_id}`);
    console.log(`${tag}    Store ID    : ${store_id}`);
    console.log(`${tag}    Metode Bayar: ${metode_pembayaran}`);

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        let discountAmount = 0;
        let appliedVoucherId = null;

        if (voucher_code) {
            console.log(`${tag} 🎟️  Validasi voucher: ${voucher_code}`);
            const [vouchers] = await connection.execute(
                'SELECT * FROM vouchers WHERE code = ? AND is_active = 1 AND (expired_at > NOW() OR expired_at IS NULL)',
                [voucher_code]
            );

            if (vouchers.length > 0) {
                const v = vouchers[0];
                const [usageResult] = await connection.execute(
                    'SELECT COUNT(*) as total_usage FROM voucher_usages WHERE voucher_id = ? AND user_id = ?',
                    [v.id, customer_id]
                );
                const currentUsage = usageResult[0].total_usage;
                const limit = v.usage_limit || 1;

                if (currentUsage < limit) {
                    appliedVoucherId = v.id;
                    discountAmount = Math.floor(rincian_biaya.subtotal_layanan * (v.discount_percent / 100));
                    if (v.max_discount_amount && discountAmount > v.max_discount_amount) {
                        discountAmount = parseFloat(v.max_discount_amount);
                    }
                    console.log(`${tag} ✅ Voucher valid — diskon: Rp${discountAmount.toLocaleString('id-ID')}`);
                } else {
                    console.log(`${tag} ⚠️  Voucher sudah dipakai (${currentUsage}/${limit}), diabaikan.`);
                }
            } else {
                console.log(`${tag} ⚠️  Voucher tidak ditemukan / tidak aktif.`);
            }
        }

        const finalTotalPrice = rincian_biaya.total_akhir - discountAmount;
        console.log(`${tag} 💰 Total bayar: Rp${finalTotalPrice.toLocaleString('id-ID')} (diskon: Rp${discountAmount.toLocaleString('id-ID')})`);

        const scheduledDate = jadwal?.tanggal || new Date().toISOString().split('T')[0];
        const scheduledTime = jadwal?.waktu || '08:00';
        const buildingType = jenisGedung || 'Rumah';
        const addressCustomer = lokasi?.alamatLengkap || '';
        const latCustomer = lokasi?.latitude || null;
        const lngCustomer = lokasi?.longitude || null;

        const [orderResult] = await connection.execute(
            `INSERT INTO orders 
             (customer_id, store_id, scheduled_date, scheduled_time, building_type, 
              address_customer, lat_customer, lng_customer, total_price, 
              platform_fee, service_fee, status, customer_notes, items, 
              discount_amount, voucher_id, order_type) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?, 'service')`,
            [
                customer_id,
                store_id,
                scheduledDate,
                scheduledTime,
                buildingType,
                addressCustomer,
                latCustomer,
                lngCustomer,
                finalTotalPrice,
                rincian_biaya.biaya_layanan_app || 0,
                rincian_biaya.biaya_transaksi || 0,
                catatan || null,
                JSON.stringify(layananTerpilih),
                discountAmount,
                appliedVoucherId
            ]
        );

        const newOrderId = orderResult.insertId;
        console.log(`${tag} 📋 Order service dibuat — ID: ${newOrderId}`);

        if (appliedVoucherId) {
            await connection.execute(
                'INSERT INTO voucher_usages (voucher_id, user_id, order_id) VALUES (?, ?, ?)',
                [appliedVoucherId, customer_id, newOrderId]
            );
        }

        for (const item of layananTerpilih) {
            await connection.execute(
                'INSERT INTO order_items (order_id, service_name, qty, price_satuan, subtotal) VALUES (?, ?, ?, ?, ?)',
                [newOrderId, item.nama, item.qty, item.hargaSatuan, item.qty * item.hargaSatuan]
            );
        }
        console.log(`${tag} 📦 ${layananTerpilih.length} item order tersimpan`);

        await connection.execute(
            "INSERT INTO payments (order_id, customer_id, payment_method, gross_amount, payment_status) VALUES (?, ?, ?, ?, 'pending')",
            [newOrderId, customer_id, metode_pembayaran, finalTotalPrice]
        );

        await connection.execute(
            "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'unpaid', 'Pesanan service dibuat')",
            [newOrderId]
        );

        await connection.commit();
        console.log(`${tag} ✅ Transaksi DB commit berhasil`);

        notifyAdmins(
            '🛒 Pesanan Service Baru!',
            `Order #${newOrderId} - Service dari toko. Total: Rp${finalTotalPrice.toLocaleString('id-ID')}`,
            newOrderId
        ).catch((e) => console.error(`${tag} ❌ notifyAdmins error:`, e.message));

        const [storeData] = await connection.execute(
            'SELECT user_id FROM stores WHERE id = ?',
            [store_id]
        );
        if (storeData.length > 0) {
            sendToUser(
                storeData[0].user_id,
                '📦 Pesanan Service Masuk!',
                `Ada pesanan service baru #${newOrderId} dari pelanggan. Segera proses!`,
                { type: 'NEW_ORDER', orderId: String(newOrderId), screen: 'OrderDetail' }
            ).catch((e) => console.error(`${tag} ❌ sendToUser error:`, e.message));
        }

        res.status(201).json({
            success: true,
            message: 'Pesanan service berhasil dibuat',
            order_id: newOrderId,
            order_type: 'service',
            rincian_pembayaran: {
                subtotal_awal: rincian_biaya.total_akhir,
                potongan_diskon: discountAmount,
                total_bayar: finalTotalPrice,
                voucher_code: voucher_code || null,
                voucher_id: appliedVoucherId
            }
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error(`${tag} ❌ Error:`, error.stack);
        res.status(500).json({ success: false, message: 'Gagal membuat pesanan service', error: error.message });
    } finally {
        if (connection) connection.release();
    }
};

// ============================================================
// createOrderWithProducts - Untuk pembelian produk toko
// ============================================================
exports.createOrderWithProducts = async (req, res) => {
    const {
        customer_id,
        store_id,
        metode_pembayaran,
        customer: customerData,
        delivery_option,
        protection,
        voucher_code,
        rincian_biaya,
        product_items
    } = req.body;

    const tag = '[createOrderWithProducts]';
    console.log(`${tag} === Incoming Product Order ===`);
    console.log(`${tag}    Customer ID : ${customer_id}`);
    console.log(`${tag}    Store ID    : ${store_id}`);
    console.log(`${tag}    Products    : ${product_items?.length || 0} items`);

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // ============================================================
        // 1. VALIDASI VOUCHER
        // ============================================================
        let discountAmount = 0;
        let appliedVoucherId = null;

        if (voucher_code) {
            console.log(`${tag} 🎟️  Validasi voucher: ${voucher_code}`);
            const [vouchers] = await connection.execute(
                'SELECT * FROM vouchers WHERE code = ? AND is_active = 1 AND (expired_at > NOW() OR expired_at IS NULL)',
                [voucher_code]
            );

            if (vouchers.length > 0) {
                const v = vouchers[0];
                const [usageResult] = await connection.execute(
                    'SELECT COUNT(*) as total_usage FROM voucher_usages WHERE voucher_id = ? AND user_id = ?',
                    [v.id, customer_id]
                );
                const currentUsage = usageResult[0].total_usage;
                const limit = v.usage_limit || 1;

                if (currentUsage < limit) {
                    appliedVoucherId = v.id;
                    discountAmount = Math.floor(rincian_biaya.subtotal_produk * (v.discount_percent / 100));
                    if (v.max_discount_amount && discountAmount > v.max_discount_amount) {
                        discountAmount = parseFloat(v.max_discount_amount);
                    }
                    console.log(`${tag} ✅ Voucher valid — diskon: Rp${discountAmount.toLocaleString('id-ID')}`);
                } else {
                    console.log(`${tag} ⚠️  Voucher sudah dipakai (${currentUsage}/${limit}), diabaikan.`);
                }
            } else {
                console.log(`${tag} ⚠️  Voucher tidak ditemukan / tidak aktif.`);
            }
        }

        // ============================================================
        // 2. HITUNG RINCIAN BIAYA (TANPA DOUBLE)
        // ============================================================
        const subtotalAmount = rincian_biaya.subtotal_produk || rincian_biaya.subtotal_layanan || 0;
        const biayaLayananApp = rincian_biaya.biaya_layanan_app || 0;  // Ini adalah platform_fee
        const transactionFee = rincian_biaya.biaya_transaksi || 0;
        const shippingFee = rincian_biaya.biaya_pengiriman || 0;
        const protectionFee = rincian_biaya.biaya_proteksi || 0;

        // 🔥 PERBAIKAN: Total = subtotal + biaya_layanan_app + transaction_fee + shipping_fee + protection_fee - discount
        // TIDAK ADA DOUBLE: platform_fee = biaya_layanan_app, service_fee = 0
        const finalTotalPrice = subtotalAmount + biayaLayananApp + transactionFee + shippingFee + protectionFee - discountAmount;

        console.log(`${tag} 💰 Rincian Biaya:`);
        console.log(`${tag}    Subtotal Produk  : Rp${subtotalAmount.toLocaleString('id-ID')}`);
        console.log(`${tag}    Biaya Layanan    : Rp${biayaLayananApp.toLocaleString('id-ID')} (platform_fee)`);
        console.log(`${tag}    Biaya Transaksi  : Rp${transactionFee.toLocaleString('id-ID')}`);
        console.log(`${tag}    Biaya Pengiriman : Rp${shippingFee.toLocaleString('id-ID')}`);
        console.log(`${tag}    Biaya Proteksi   : Rp${protectionFee.toLocaleString('id-ID')}`);
        console.log(`${tag}    Diskon Voucher   : -Rp${discountAmount.toLocaleString('id-ID')}`);
        console.log(`${tag}    TOTAL AKHIR     : Rp${finalTotalPrice.toLocaleString('id-ID')}`);

        // ============================================================
        // 3. PREPARE DATA CUSTOMER
        // ============================================================
        const scheduledDate = customerData?.delivery_date || new Date().toISOString().split('T')[0];
        const scheduledTime = customerData?.delivery_time || '08:00';
        const buildingType = customerData?.building_type || 'Rumah';
        const addressCustomer = customerData?.address || '';
        const addressNote = customerData?.address_note || null;
        const latCustomer = customerData?.latitude || null;
        const lngCustomer = customerData?.longitude || null;
        const customerNotes = customerData?.address_note || null;

        console.log(`${tag} 📅 Tanggal: ${scheduledDate}, Waktu: ${scheduledTime}`);
        console.log(`${tag} 📍 Alamat: ${addressCustomer}`);

        // ============================================================
        // 4. INSERT ORDER (DENGAN PERBAIKAN DOUBLE FEE)
        // ============================================================
        const [orderResult] = await connection.execute(
            `INSERT INTO orders 
             (customer_id, store_id, scheduled_date, scheduled_time, building_type, 
              address_customer, address_note, lat_customer, lng_customer, 
              customer_phone, customer_email,
              total_price, subtotal, platform_fee, service_fee, transaction_fee, shipping_fee,
              status, payment_status, customer_notes, items, 
              discount_amount, voucher_id, voucher_code, order_type, 
              delivery_option, protection, payment_method) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                customer_id,
                store_id,
                scheduledDate,
                scheduledTime,
                buildingType,
                addressCustomer,
                addressNote,
                latCustomer,
                lngCustomer,
                customerData?.phone || null,
                customerData?.email || null,
                finalTotalPrice,                    // total_price
                subtotalAmount,                     // subtotal
                biayaLayananApp,                    // platform_fee (biaya layanan app)
                0,                                  // service_fee (0, TIDAK DOUBLE)
                transactionFee,                     // transaction_fee
                shippingFee,                        // shipping_fee
                'unpaid',                           // status
                'unpaid',                           // payment_status
                customerNotes,
                JSON.stringify(product_items),
                discountAmount,
                appliedVoucherId,
                voucher_code || null,
                'product',                          // order_type
                delivery_option || 'instant',       // delivery_option
                protection ? 1 : 0,                 // protection
                metode_pembayaran || 'QRIS'         // payment_method
            ]
        );

        const newOrderId = orderResult.insertId;
        console.log(`${tag} 📋 Order produk dibuat — ID: ${newOrderId}`);

        // ============================================================
        // 5. SIMPAN VOUCHER USAGE
        // ============================================================
        if (appliedVoucherId) {
            await connection.execute(
                'INSERT INTO voucher_usages (voucher_id, user_id, order_id) VALUES (?, ?, ?)',
                [appliedVoucherId, customer_id, newOrderId]
            );
            console.log(`${tag} ✅ Voucher usage tersimpan`);
        }

        // ============================================================
        // 6. INSERT ORDER ITEMS
        // ============================================================
        for (const item of product_items) {
            const priceSatuan = item.priceNumber || 0;
            const qty = item.qty || 1;
            const subtotalItem = priceSatuan * qty;

            await connection.execute(
                `INSERT INTO order_items 
                 (order_id, product_id, product_name, variant, qty, price_satuan, subtotal, service_name) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    newOrderId,
                    parseInt(item.id) || null,
                    item.name || 'Produk',
                    item.variant || 'Default',
                    qty,
                    priceSatuan,
                    subtotalItem,
                    item.name || 'Produk'
                ]
            );
        }
        console.log(`${tag} 📦 ${product_items.length} produk tersimpan`);

        // ============================================================
        // 7. INSERT PAYMENT
        // ============================================================
        await connection.execute(
            `INSERT INTO payments 
             (order_id, customer_id, payment_method, gross_amount, payment_status) 
             VALUES (?, ?, ?, ?, ?)`,
            [newOrderId, customer_id, metode_pembayaran || 'QRIS', finalTotalPrice, 'pending']
        );
        console.log(`${tag} ✅ Payment tersimpan (status: pending)`);

        // ============================================================
        // 8. INSERT ORDER STATUS LOG
        // ============================================================
        await connection.execute(
            `INSERT INTO order_status_logs (order_id, status, notes) 
             VALUES (?, 'unpaid', 'Pesanan produk dibuat')`,
            [newOrderId]
        );
        console.log(`${tag} ✅ Status log tersimpan`);

        // ============================================================
        // 9. INSERT PROTECTION (JIKA ADA)
        // ============================================================
        if (protection) {
            try {
                await connection.execute(
                    `INSERT INTO order_protections (order_id, is_active, protection_fee) 
                     VALUES (?, ?, ?)`,
                    [newOrderId, 1, protectionFee || 0]
                );
                console.log(`${tag} ✅ Proteksi tersimpan`);
            } catch (protError) {
                console.warn(`${tag} ⚠️  Gagal simpan proteksi:`, protError.message);
            }
        }

        // ============================================================
        // 10. COMMIT TRANSACTION
        // ============================================================
        await connection.commit();
        console.log(`${tag} ✅ Transaksi DB commit berhasil`);

        // ============================================================
        // 11. NOTIFIKASI
        // ============================================================
        // Notifikasi ke admin
        notifyAdmins(
            '🛒 Pesanan Produk Baru!',
            `Order #${newOrderId} - ${product_items.length} produk. Total: Rp${finalTotalPrice.toLocaleString('id-ID')}`,
            newOrderId
        ).catch((e) => console.error(`${tag} ❌ notifyAdmins error:`, e.message));

        // Notifikasi ke toko/mitra
        const [storeData] = await connection.execute(
            'SELECT user_id FROM stores WHERE id = ?',
            [store_id]
        );
        if (storeData.length > 0) {
            sendToUser(
                storeData[0].user_id,
                '📦 Pesanan Produk Masuk!',
                `Ada pesanan produk baru #${newOrderId} dari pelanggan. Segera proses!`,
                { type: 'NEW_ORDER', orderId: String(newOrderId), screen: 'OrderDetail' }
            ).catch((e) => console.error(`${tag} ❌ sendToUser error:`, e.message));
        }

        // ============================================================
        // 12. RESPONSE
        // ============================================================
        res.status(201).json({
            success: true,
            message: 'Pesanan produk berhasil dibuat',
            order_id: newOrderId,
            order_type: 'product',
            rincian_pembayaran: {
                subtotal: subtotalAmount,
                platform_fee: biayaLayananApp,
                service_fee: 0, // TIDAK DOUBLE
                transaction_fee: transactionFee,
                shipping_fee: shippingFee,
                protection_fee: protectionFee,
                potongan_diskon: discountAmount,
                total_bayar: finalTotalPrice,
                voucher_code: voucher_code || null,
                voucher_id: appliedVoucherId
            }
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error(`${tag} ❌ Error:`, error.stack);
        res.status(500).json({
            success: false,
            message: 'Gagal membuat pesanan produk',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
};
// ============================================================
// getOrderDetail - Updated untuk support product & service
// ============================================================
exports.getOrderDetail = async (req, res) => {
    const { id } = req.params;
    try {
        const sql = `
            SELECT 
                o.*, 
                u.full_name        AS customer_name, 
                u.phone_number     AS customer_phone, 
                u.email            AS customer_email,
                u.fcm_token        AS customer_fcm,
                o.address_customer AS address_customer, 
                o.address_note     AS address_note,
                m.full_name        AS mitra_name, 
                m.phone_number     AS mitra_phone,
                s.store_name,
                IFNULL(s.commission_rate, 70) AS commission_rate,
                (o.total_price + o.discount_amount) AS original_subtotal,
                FLOOR((o.total_price + o.discount_amount) * (IFNULL(s.commission_rate, 70) / 100)) AS projected_mitra_earning,
                (SELECT rating FROM reviews WHERE order_id = o.id LIMIT 1) AS already_rated,
                o.order_type,
                o.subtotal,
                o.platform_fee,
                o.service_fee,
                o.transaction_fee,
                o.shipping_fee,
                o.discount_amount,
                o.protection,
                o.delivery_option,
                o.payment_method,
                o.payment_status,
                o.voucher_code,
                (SELECT JSON_ARRAYAGG(
                    JSON_OBJECT(
                        'nama', IFNULL(oi.product_name, oi.service_name),
                        'qty', oi.qty,
                        'hargaSatuan', oi.price_satuan,
                        'variant', oi.variant,
                        'type', IF(oi.product_id IS NOT NULL, 'product', 'service')
                    )
                 ) FROM order_items oi WHERE oi.order_id = o.id) AS items
            FROM orders o 
            LEFT JOIN users u  ON o.customer_id = u.id 
            LEFT JOIN stores s ON o.store_id    = s.id 
            LEFT JOIN users m  ON s.user_id     = m.id 
            WHERE o.id = ?`;

        const [rows] = await db.execute(sql, [id]);
        if (rows.length === 0)
            return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan' });

        const data = rows[0];
        data.commission_rate = parseCommission(data.commission_rate);
        if (data.proof_image_url && !data.proof_image_url.startsWith('http')) {
            data.proof_image_url = `${req.protocol}://${req.get('host')}/${data.proof_image_url.replace(/\\/g, '/')}`;
        }

        // Parse items jika berupa string
        if (typeof data.items === 'string') {
            try {
                data.items = JSON.parse(data.items);
            } catch (e) {
                data.items = [];
            }
        }

        res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('[getOrderDetail] Error:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
    }
};
// ============================================================
// getStoreOrders - Untuk toko melihat pesanan mereka
// ============================================================
exports.getStoreOrders = async (req, res) => {
    const { storeId } = req.params;
    try {
        const [rows] = await db.execute(
            `SELECT 
                o.id, o.status, o.total_price, o.discount_amount, 
                o.scheduled_date, o.scheduled_time, o.order_date,
                o.order_type,
                u.full_name AS customer_name,
                u.phone_number AS customer_phone,
                u.address AS customer_address,
                (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS total_items
             FROM orders o
             JOIN users u ON o.customer_id = u.id
             WHERE o.store_id = ?
             ORDER BY o.order_date DESC`,
            [storeId]
        );
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error('[getStoreOrders] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ============================================================
// updateOrderStatusByStore - Toko update status order
// ============================================================
exports.updateOrderStatusByStore = async (req, res) => {
    const { id } = req.params;
    const { status, notes } = req.body;
    const tag = `[updateOrderStatusByStore][Order#${id}]`;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [orderData] = await connection.execute(
            `SELECT o.status, o.customer_id, u.full_name, s.user_id AS store_owner_id
             FROM orders o 
             JOIN users u ON o.customer_id = u.id
             JOIN stores s ON o.store_id = s.id
             WHERE o.id = ? FOR UPDATE`,
            [id]
        );

        if (orderData.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }

        const currentStatus = orderData[0].status;
        const customerId = orderData[0].customer_id;
        const customerName = orderData[0].full_name;

        // Validasi status yang valid untuk toko
        const validStoreStatuses = ['accepted', 'on_the_way', 'working', 'completed', 'cancelled'];
        if (!validStoreStatuses.includes(status)) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Status tidak valid untuk toko'
            });
        }

        if (['completed', 'cancelled'].includes(currentStatus)) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Pesanan sudah final'
            });
        }

        await connection.execute(
            'UPDATE orders SET status = ? WHERE id = ?',
            [status, id]
        );

        await connection.execute(
            'INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, ?, ?)',
            [id, status, notes || `Status diupdate ke ${status} oleh toko`]
        );

        await connection.commit();

        // Notifikasi ke customer
        const statusMessages = {
            accepted: 'Pesanan Anda telah diterima oleh toko',
            on_the_way: 'Pesanan Anda sedang dalam perjalanan',
            working: 'Pesanan Anda sedang diproses',
            completed: 'Pesanan Anda telah selesai ✅',
            cancelled: 'Pesanan Anda dibatalkan oleh toko ❌'
        };

        sendToUser(
            customerId,
            '📦 Update Pesanan',
            statusMessages[status] || `Status pesanan: ${status}`,
            { type: 'ORDER_STATUS_UPDATE', orderId: String(id), screen: 'OrderDetail' }
        ).catch((e) => console.error(`${tag} ❌ sendToUser error:`, e.message));

        // Notifikasi admin
        notifyAdmins(
            '🛠️ Update Status Order oleh Toko',
            `Order #${id} diubah ke "${status}" oleh toko.`,
            id
        ).catch((e) => console.error(`${tag} ❌ notifyAdmins error:`, e.message));

        res.status(200).json({
            success: true,
            message: `Status berhasil diupdate ke ${status}`,
            data: { orderId: id, status }
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error(`${tag} ❌ Error:`, error.stack);
        res.status(500).json({ success: false, message: 'Server error.', error: error.message });
    } finally {
        connection.release();
    }
};

// ============================================================
// getUserOrders
// ============================================================
exports.getUserOrders = async (req, res) => {
    try {
        const { userId } = req.params;
        const [rows] = await db.execute(
            `SELECT 
                o.id, o.status, o.total_price, o.discount_amount, 
                o.scheduled_date, o.scheduled_time, o.order_date, o.cancelled_by,
                o.order_type,
                s.store_name AS mitra_name 
             FROM orders o
             JOIN stores s ON o.store_id = s.id
             WHERE o.customer_id = ?
             ORDER BY o.order_date DESC`,
            [userId]
        );
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error('[getUserOrders] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ============================================================
// cancelOrder
// ============================================================
exports.cancelOrder = async (req, res) => {
    const { orderId, reason } = req.body;
    const tag = `[cancelOrder][Order#${orderId}]`;
    try {
        const [result] = await db.execute(
            `UPDATE orders 
             SET status = 'cancelled', cancelled_by = 'customer', cancel_reason = ? 
             WHERE id = ? AND status IN ('pending', 'unpaid')`,
            [reason, orderId]
        );

        if (result.affectedRows > 0) {
            console.log(`${tag} ✅ Order berhasil dibatalkan oleh customer`);
            notifyAdmins(
                '⚠️ Pesanan Dibatalkan',
                `Order #${orderId} dibatalkan pelanggan. Alasan: ${reason || '-'}`,
                orderId
            ).catch((e) => console.error(`${tag} ❌ notifyAdmins error:`, e.message));

            res.json({ success: true, message: 'Pesanan berhasil dibatalkan' });
        } else {
            res.status(400).json({ success: false, message: 'Pesanan tidak dapat dibatalkan' });
        }
    } catch (error) {
        console.error('[cancelOrder] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ============================================================
// getAllOrdersAdmin - Updated dengan order_type
// ============================================================
exports.getAllOrdersAdmin = async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT 
                o.id, o.status, o.customer_notes, o.total_price, 
                o.platform_fee, o.service_fee, o.scheduled_date, o.scheduled_time, 
                o.order_date, o.cancelled_by, o.cancel_reason,
                o.order_type,
                s.store_name AS mitra_name, 
                IFNULL(s.commission_rate, 70) AS commission_rate,
                FLOOR((o.total_price + IFNULL(o.discount_amount, 0)) * (IFNULL(s.commission_rate, 70) / 100)) AS mitra_earning,
                ((o.total_price + IFNULL(o.discount_amount, 0)) - FLOOR((o.total_price + IFNULL(o.discount_amount, 0)) * (IFNULL(s.commission_rate, 70) / 100))) AS app_profit,
                u.full_name AS customer_name, 
                p.payment_method, p.payment_type, p.payment_status
             FROM orders o
             JOIN stores s  ON o.store_id    = s.id
             JOIN users u   ON o.customer_id = u.id
             LEFT JOIN payments p ON o.id    = p.order_id
             ORDER BY o.order_date DESC`
        );
        const normalized = rows.map((r) => ({
            ...r,
            commission_rate: parseCommission(r.commission_rate)
        }));
        res.status(200).json({ success: true, data: normalized });
    } catch (error) {
        console.error('[getAllOrdersAdmin] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ============================================================
// getRefundHistory
// ============================================================
exports.getRefundHistory = async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT 
                p.order_id, u.full_name AS customer_name, p.gross_amount AS nominal_refund, 
                p.transaction_time AS tanggal_refund, o.status AS order_status, 
                o.platform_fee, o.service_fee, o.cancelled_by, o.cancel_reason
             FROM payments p
             JOIN orders o ON p.order_id   = o.id
             JOIN users u  ON o.customer_id = u.id
             WHERE p.payment_status = 'refund'
             ORDER BY p.transaction_time DESC`
        );
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error('[getRefundHistory] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ============================================================
// updateOrderStatus (oleh Mitra/Service Provider)
// ============================================================
exports.updateOrderStatus = async (req, res) => {
    const { id } = req.params;
    const { status, notes } = req.body;
    const tag = `[updateOrderStatus][Order#${id}]`;
    const connection = await db.getConnection();

    console.log(`${tag} === Request status → "${status}" ===`);

    try {
        await connection.beginTransaction();

        const [orderData] = await connection.execute(
            `SELECT o.status, o.proof_image_url, o.customer_id, u.full_name 
             FROM orders o 
             JOIN users u ON o.customer_id = u.id 
             WHERE o.id = ? FOR UPDATE`,
            [id]
        );

        if (orderData.length === 0) {
            if (req.file) fs.unlinkSync(req.file.path);
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }

        const currentStatus = orderData[0].status;
        const customerId = orderData[0].customer_id;
        const customerName = orderData[0].full_name;

        console.log(`${tag} Status saat ini: "${currentStatus}" → akan diubah ke "${status}"`);

        if (['completed', 'cancelled'].includes(currentStatus)) {
            if (req.file) fs.unlinkSync(req.file.path);
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Pesanan sudah bersifat final.' });
        }

        let proofImageUrl = orderData[0].proof_image_url;
        if (req.file) {
            proofImageUrl = req.file.path.replace(/\\/g, '/');
            console.log(`${tag} 📷 Bukti foto diterima: ${proofImageUrl}`);
        }

        let statusToSave = status;
        let cancelledBy = null;
        let responseMessage = `Status berhasil diperbarui ke ${status}`;

        if (status === 'completed') {
            if (!req.file && !proofImageUrl) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Bukti foto wajib diunggah.' });
            }
            statusToSave = 'working';
            responseMessage = 'Laporan pengerjaan terkirim. Menunggu konfirmasi pelanggan.';
        } else if (status === 'cancelled') {
            cancelledBy = 'mitra';
            responseMessage = 'Pesanan berhasil dibatalkan.';
        }

        await connection.execute(
            'UPDATE orders SET status = ?, proof_image_url = ?, cancelled_by = ? WHERE id = ?',
            [statusToSave, proofImageUrl, cancelledBy, id]
        );

        const logNotes = status === 'cancelled'
            ? `Dibatalkan oleh mitra. Alasan: ${notes || 'Tidak ada alasan'}`
            : status === 'completed'
                ? 'Mitra melaporkan pekerjaan selesai'
                : `Status diperbarui ke ${statusToSave} oleh mitra`;

        await connection.execute(
            'INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, ?, ?)',
            [id, statusToSave, logNotes]
        );

        await connection.commit();
        console.log(`${tag} ✅ DB commit — status tersimpan: "${statusToSave}"`);

        // Notif admin
        notifyAdmins(
            '🛠️ Update Status Order',
            `Order #${id} diubah ke "${statusToSave}" oleh mitra.`,
            id
        ).catch((e) => console.error(`${tag} ❌ notifyAdmins error:`, e.message));

        res.status(200).json({
            success: true,
            message: responseMessage,
            data: { orderId: id, status: statusToSave, cancelled_by: cancelledBy }
        });

        // Notif ke customer (after response)
        const statusMap = {
            accepted: 'telah diterima oleh teknisi',
            on_the_way: 'sedang menuju lokasi Anda',
            working: 'sedang dikerjakan',
            completed: 'telah selesai dikerjakan dan menunggu konfirmasi Anda ✅',
            cancelled: 'telah dibatalkan oleh mitra ❌'
        };
        const notifTitle = status === 'cancelled' ? '❌ Pesanan Dibatalkan' : '🔔 Update Pesanan';
        const notifBody = `Halo ${customerName}, pesanan Anda ${statusMap[status] || status}`;

        console.log(`${tag} 📲 Mengirim notif ke customer UID: ${customerId}`);
        sendToUser(customerId, notifTitle, notifBody, {
            orderId: String(id),
            type: 'ORDER_STATUS_UPDATE',
            status: String(statusToSave),
            screen: 'OrderDetail',           // hint navigasi Expo
        }).catch((e) => console.error(`${tag} ❌ sendToUser error:`, e.message));

    } catch (error) {
        if (connection) await connection.rollback();
        if (req.file) fs.unlinkSync(req.file.path);
        console.error(`${tag} ❌ Error:`, error.stack);
        if (!res.headersSent)
            res.status(500).json({ success: false, message: 'Server error.', error: error.message });
    } finally {
        connection.release();
    }
};

// ============================================================
// customerCompleteOrder
// ✅ Hanya SATU notifyAdmins di sini — tidak ada di releaseFunds
// ============================================================
exports.customerCompleteOrder = async (req, res) => {
    const { id } = req.params;
    const { rating, comment, quality, punctuality, communication } = req.body;
    const tag = `[customerCompleteOrder][Order#${id}]`;
    const connection = await db.getConnection();

    console.log(`${tag} === Memulai Konfirmasi Order ===`);

    try {
        await connection.beginTransaction();

        const [orderData] = await connection.execute(
            'SELECT customer_id, store_id, status FROM orders WHERE id = ?',
            [id]
        );
        if (orderData.length === 0) throw new Error('Order tidak ditemukan');

        const { customer_id, store_id, status: currentStatus } = orderData[0];
        console.log(`${tag} Status saat ini: "${currentStatus}"`);

        // Simpan review
        await connection.execute(
            `INSERT INTO reviews 
             (order_id, customer_id, store_id, rating, rating_quality, rating_punctuality, rating_communication, comment) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment)`,
            [id, customer_id, store_id,
                parseInt(rating) || 5, parseInt(quality) || 5,
                parseInt(punctuality) || 5, parseInt(communication) || 5,
                comment || '']
        );
        console.log(`${tag} ⭐ Review tersimpan — rating: ${rating}`);

        const [updateResult] = await connection.execute(
            "UPDATE orders SET status = 'completed' WHERE id = ? AND status != 'completed'",
            [id]
        );

        // Update rating toko
        await connection.execute(
            `UPDATE stores SET 
                average_rating = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE store_id = ?), 
                total_reviews  = (SELECT COUNT(*) FROM reviews WHERE store_id = ?) 
             WHERE id = ?`,
            [store_id, store_id, store_id]
        );

        let releaseResult = null;

        if (updateResult.affectedRows > 0) {
            console.log(`${tag} 🔄 Status order diubah ke "completed"`);

            // Pencairan dana — TIDAK ada notifyAdmins di dalamnya
            releaseResult = await releaseFundsToMitra(connection, id);

            if (releaseResult) {
                const formatted = new Intl.NumberFormat('id-ID', {
                    style: 'currency', currency: 'IDR', maximumFractionDigits: 0
                }).format(releaseResult.netAmount);

                // ✅ SATU notif admin — gabungan info selesai + pencairan
                notifyAdmins(
                    '✅ Order Selesai & Dana Cair',
                    `Order #${id} dikonfirmasi selesai. Rating: ${rating}⭐. Dana ${formatted} masuk ke dompet ${releaseResult.store_name}.`,
                    id
                ).catch((e) => console.error(`${tag} ❌ notifyAdmins error:`, e.message));

                // Notif ke mitra
                console.log(`${tag} 📲 Mengirim notif ke mitra UID: ${releaseResult.mitra_user_id}`);
                sendToUser(
                    releaseResult.mitra_user_id,
                    '💰 Dana Masuk!',
                    `Selamat! Pendapatan ${formatted} dari Order #${id} masuk ke dompet Anda.`,
                    { type: 'WALLET_UPDATE', orderId: String(id), screen: 'Wallet' }
                ).catch((e) => console.error(`${tag} ❌ sendToUser mitra error:`, e.message));

            } else {
                // releaseFunds return false = sudah pernah dicairkan
                // Tetap kirim notif admin tapi tanpa info pencairan
                notifyAdmins(
                    '✅ Order Selesai',
                    `Order #${id} dikonfirmasi selesai oleh pelanggan. Rating: ${rating}⭐`,
                    id
                ).catch((e) => console.error(`${tag} ❌ notifyAdmins error:`, e.message));
            }
        } else {
            console.log(`${tag} ℹ️  Order sudah completed sebelumnya, hanya update review`);
        }

        await connection.commit();
        console.log(`${tag} ✅ DB commit berhasil`);

        res.status(200).json({
            success: true,
            message: updateResult.affectedRows > 0
                ? 'Pesanan selesai & dana dicairkan.'
                : 'Ulasan diperbarui.'
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error(`${tag} ❌ Error:`, error.stack);
        res.status(500).json({ success: false, message: 'Gagal memproses', error: error.message });
    } finally {
        if (connection) connection.release();
    }
};

exports.internalReleaseFunds = releaseFundsToMitra;