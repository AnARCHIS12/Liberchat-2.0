const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
    cors: {
        origin: process.env.NODE_ENV === 'production' 
            ? false 
            : ["http://localhost:3000", "http://127.0.0.1:3000"],
        methods: ["GET", "POST"]
    }
});
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');

// Assurez-vous que le dossier uploads existe
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configuration de multer pour l'upload des fichiers
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
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

// Middleware pour la sécurité
app.use((req, res, next) => {
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'DENY');
    res.header('X-XSS-Protection', '1; mode=block');
    next();
});

// Middleware pour servir les fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Route principale
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
const activeUsers = new Map();
const messages = [];

io.on('connection', (socket) => {
    console.log('Nouvelle connexion:', socket.id);

    socket.on('register', (username) => {
        if (!username || typeof username !== 'string' || username.trim().length === 0) {
            socket.emit('error', 'Nom d\'utilisateur invalide');
            return;
        }

        activeUsers.set(socket.id, username);
        io.emit('chat message', {
            type: 'system',
            content: `${username} a rejoint le chat.`
        });
        
        io.emit('users update', Array.from(activeUsers.values()));
    });

    socket.on('chat message', (msg) => {
        const username = activeUsers.get(socket.id);
        if (username && msg && typeof msg === 'string' && msg.trim().length > 0) {
            const messageData = {
                type: 'message',
                username: username,
                content: msg,
                timestamp: Date.now()
            };
            messages.push(messageData);
            if (messages.length > 100) messages.shift(); // Garde seulement les 100 derniers messages
            io.emit('chat message', messageData);
        }
    });

    socket.on('file message', (data) => {
        const username = activeUsers.get(socket.id);
        if (username && data && data.fileUrl && data.fileType) {
            const fileMessage = {
                type: 'file',
                username: username,
                fileUrl: data.fileUrl,
                fileType: data.fileType,
                timestamp: Date.now()
            };
            messages.push(fileMessage);
            if (messages.length > 100) messages.shift();
            io.emit('chat message', fileMessage);
        }
    });

    socket.on('disconnect', () => {
        const username = activeUsers.get(socket.id);
        if (username) {
            io.emit('chat message', {
                type: 'system',
                content: `${username} a quitté le chat.`
            });
            activeUsers.delete(socket.id);
            io.emit('users update', Array.from(activeUsers.values()));
        }
    });
});

// Nettoyage des anciens fichiers (toutes les heures)
setInterval(() => {
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
                // Supprime les fichiers de plus de 24h
                if (now - stats.ctimeMs > 24 * 60 * 60 * 1000) {
                    fs.unlink(filePath, err => {
                        if (err) console.error(`Erreur lors de la suppression de ${file}:`, err);
                    });
                }
            });
        });
    });
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});

// Gestion gracieuse de l'arrêt
process.on('SIGTERM', () => {
    server.close(() => {
        console.log('Serveur arrêté proprement');
        process.exit(0);
    });
});
