const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');

// Configuration de multer pour l'upload des fichiers
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(8).toString('hex');
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/webm'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Type de fichier non autorisé'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 // Limite à 50MB
    }
});

// Middleware pour servir les fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Route principale pour servir l'interface
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route pour l'upload de fichiers
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Aucun fichier uploadé' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ 
        success: true, 
        fileUrl: fileUrl,
        fileType: req.file.mimetype
    });
});

// Gestion des erreurs pour multer
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Fichier trop volumineux' });
        }
        return res.status(400).json({ error: err.message });
    }
    next(err);
});

// Gestion des utilisateurs et messages
const activeUsers = {};
const messages = []; // Stockage temporaire des messages

io.on('connection', (socket) => {
    console.log('Nouvelle connexion:', socket.id);

    socket.on('register', (username) => {
        // Vérification du nom d'utilisateur
        if (!username || typeof username !== 'string' || username.trim().length === 0) {
            socket.emit('error', 'Nom d\'utilisateur invalide');
            return;
        }

        activeUsers[socket.id] = username;
        console.log(`${username} a rejoint le chat.`);
        io.emit('chat message', {
            type: 'system',
            content: `${username} a rejoint le chat.`
        });
        
        // Envoyer la liste des utilisateurs actifs
        io.emit('users update', Object.values(activeUsers));
    });

    socket.on('chat message', (msg) => {
        const username = activeUsers[socket.id];
        if (username && msg && typeof msg === 'string' && msg.trim().length > 0) {
            const messageData = {
                type: 'message',
                username: username,
                content: msg,
                timestamp: Date.now()
            };
            messages.push(messageData);
            io.emit('chat message', messageData);
        }
    });

    socket.on('file message', (data) => {
        const username = activeUsers[socket.id];
        if (username && data && data.fileUrl && data.fileType) {
            const fileMessage = {
                type: 'file',
                username: username,
                fileUrl: data.fileUrl,
                fileType: data.fileType,
                timestamp: Date.now()
            };
            messages.push(fileMessage);
            io.emit('chat message', fileMessage);
        }
    });

    socket.on('disconnect', () => {
        const username = activeUsers[socket.id];
        if (username) {
            console.log(`${username} a quitté le chat.`);
            io.emit('chat message', {
                type: 'system',
                content: `${username} a quitté le chat.`
            });
            delete activeUsers[socket.id];
            // Mettre à jour la liste des utilisateurs
            io.emit('users update', Object.values(activeUsers));
        }
    });
});

// Nettoyage des anciens fichiers (toutes les heures)
setInterval(() => {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (fs.existsSync(uploadDir)) {
        fs.readdir(uploadDir, (err, files) => {
            if (err) {
                console.error('Erreur lors de la lecture du dossier uploads:', err);
                return;
            }
            const now = Date.now();
            files.forEach(file => {
                const filePath = path.join(uploadDir, file);
                fs.stat(filePath, (err, stats) => {
                    if (err) {
                        console.error(`Erreur lors de la lecture des stats de ${file}:`, err);
                        return;
                    }
                    if (now - stats.ctimeMs > 24 * 60 * 60 * 1000) { // 24 heures
                        fs.unlink(filePath, err => {
                            if (err) console.error(`Erreur lors de la suppression de ${file}:`, err);
                            else console.log(`Fichier supprimé: ${file}`);
                        });
                    }
                });
            });
        });
    }
}, 60 * 60 * 1000);

// Port dynamique fourni par Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
