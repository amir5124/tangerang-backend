const db = require('../config/db');
const fs = require('fs');
const path = require('path');

// 1. TAMBAH JASA BARU
exports.createService = async (req, res) => {
    try {
        const { store_id, service_name, price, price_type, description } = req.body;
        const image_url = req.file ? `/uploads/services/${req.file.filename}` : null;

        // Query menyertakan kolom description yang baru ditambahkan
        const query = `
            INSERT INTO services (store_id, service_name, price_type, base_price, image_url, description) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        const [result] = await db.query(query, [
            store_id,
            service_name,
            price_type || 'fixed',
            price, // 'price' dari req.body masuk ke 'base_price' di DB
            image_url,
            description || null
        ]);

        console.log(`>>> [Success] Jasa baru dibuat: ${service_name}`);
        res.status(201).json({
            message: "Jasa berhasil ditambahkan",
            serviceId: result.insertId,
            image_url
        });
    } catch (err) {
        console.error(">>> [Error] createService:", err.message);
        res.status(500).json({ error: err.message });
    }
};

// 2. AMBIL DAFTAR JASA PER TOKO (Untuk Tampilan List)
exports.getServicesByStore = async (req, res) => {
    const { store_id } = req.params;
    const query = "SELECT * FROM services WHERE store_id = ? ORDER BY id DESC";
    try {
        const [results] = await db.query(query, [store_id]);
        res.json(results);
    } catch (err) {
        console.error(">>> [Error] getServicesByStore:", err.message);
        res.status(500).json({ error: err.message });
    }
};

// 3. EDIT / UPDATE JASA (Mendukung Teks & Gambar)
exports.updateService = async (req, res) => {
    const { id } = req.params;
    const { service_name, price, price_type, description } = req.body;

    try {
        // Cek data lama untuk menghapus foto lama jika ada upload foto baru
        const [oldService] = await db.query("SELECT image_url FROM services WHERE id = ?", [id]);

        if (oldService.length === 0) {
            return res.status(404).json({ message: "Jasa tidak ditemukan" });
        }

        let query = `UPDATE services SET service_name=?, base_price=?, price_type=?, description=?`;
        let params = [service_name, price, price_type, description];

        // Jika ada file gambar baru yang diunggah
        if (req.file) {
            const new_image_url = `/uploads/services/${req.file.filename}`;
            query += `, image_url=?`;
            params.push(new_image_url);

            // Hapus file fisik lama dari storage server agar tidak menumpuk
            if (oldService[0].image_url) {
                const oldPath = path.join(__dirname, '..', oldService[0].image_url);
                if (fs.existsSync(oldPath)) {
                    fs.unlinkSync(oldPath);
                }
            }
        }

        query += ` WHERE id=?`;
        params.push(id);

        const [result] = await db.query(query, params);

        console.log(`>>> [Success] Jasa ID ${id} diperbarui.`);
        res.json({ message: "Update berhasil", affectedRows: result.affectedRows });
    } catch (err) {
        console.error(">>> [Error] updateService:", err.message);
        res.status(500).json({ error: err.message });
    }
};

// 4. HAPUS JASA
exports.deleteService = async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Cari data jasa untuk mendapatkan path gambar
        const [service] = await db.query("SELECT image_url FROM services WHERE id = ?", [id]);

        if (service.length === 0) {
            return res.status(404).json({ message: "Jasa tidak ditemukan" });
        }

        // 2. Hapus file fisik gambar jika ada
        if (service[0].image_url) {
            const filePath = path.join(__dirname, '..', service[0].image_url);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        // 3. Hapus record dari database
        const [result] = await db.query("DELETE FROM services WHERE id = ?", [id]);

        console.log(`>>> [Success] Jasa ID ${id} dihapus.`);
        res.json({ message: "Jasa berhasil dihapus" });
    } catch (err) {
        console.error(">>> [Error] deleteService:", err.message);
        res.status(500).json({ error: err.message });
    }
};