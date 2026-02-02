const db = require('../config/db');

exports.createService = async (req, res) => {
    try {
        // Kita tidak mengambil 'category' atau 'description' karena tidak ada di tabel services
        const { store_id, service_name, price, price_type } = req.body;
        const image_url = req.file ? `/uploads/services/${req.file.filename}` : null;

        // Query sesuai DESCRIBE services: store_id, service_name, price_type, base_price, image_url
        const query = `
            INSERT INTO services (store_id, service_name, price_type, base_price, image_url) 
            VALUES (?, ?, ?, ?, ?)
        `;

        const [result] = await db.query(query, [
            store_id,
            service_name,
            price_type || 'fixed',
            price,
            image_url
        ]);

        res.status(201).json({
            message: "Jasa berhasil ditambahkan",
            serviceId: result.insertId,
            image_url
        });
    } catch (err) {
        console.error(">>> [DB Error] createService:", err.message);
        res.status(500).json({ error: err.message });
    }
};

exports.getServicesByStore = async (req, res) => {
    const { store_id } = req.params;
    // Kita bisa melakukan JOIN ke tabel stores jika butuh info kategorinya di sini
    const query = "SELECT * FROM services WHERE store_id = ?";
    try {
        const [results] = await db.query(query, [store_id]);
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateService = async (req, res) => {
    const { id } = req.params;
    try {
        const { service_name, price, price_type } = req.body;
        let query = `UPDATE services SET service_name=?, base_price=?, price_type=?`;
        let params = [service_name, price, price_type || 'fixed'];

        if (req.file) {
            const image_url = `/uploads/services/${req.file.filename}`;
            query += `, image_url=?`;
            params.push(image_url);
        }

        query += ` WHERE id=?`;
        params.push(id);

        await db.query(query, params);
        res.json({ message: "Jasa berhasil diperbarui" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};