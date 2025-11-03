// --- Imports ---
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); 
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path'); 

// --- App Setup ---
const app = express();
// (Railway/Replit සඳහා) PORT එක ස්වයංක්‍රීයව ලබා ගැනීම
const PORT = process.env.PORT || 3000; 

// --- Secrets (Railway/Replit "Variables" වෙතින් ලබා ගනී) ---
const JWT_SECRET = process.env.JWT_SECRET || 'your-default-secret-key-12345';
const atlasConnectionString = process.env.atlasConnectionString;

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname))); // HTML ගොනු serve කිරීම

// --- Database Connection (MongoDB Atlas) ---
if (!atlasConnectionString) {
    console.error("FATAL ERROR: atlasConnectionString is not defined in Environment Variables.");
    console.log("Please add atlasConnectionString to your Railway/Replit Secrets.");
} else {
    mongoose.connect(atlasConnectionString)
        .then(() => console.log('MongoDB Atlas connected...'))
        .catch(err => {
            console.error("MongoDB Connection Error:", err.message);
        });
}

// --- (අලුත්) User Database Model (Coins & Upgrades ඇතුළත්) ---
const UserSchema = new mongoose.Schema({
    accountName: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    accountNumber: { type: Number, required: true, unique: true },
    balance: { type: Number, default: 0 }, // සැබෑ මුදල් (eZ Cash) ශේෂය
    coins: { type: Number, default: 0 }, // In-Game Currency
    upgrades: {
        engineLevel: { type: Number, default: 1 },
        rims: { type: String, default: 'Stock' }, // e.g., 'Stock', 'Spinner'
        hasTurbo: { type: Boolean, default: false }
    }
});
const User = mongoose.model('User', UserSchema);

// --- (අලුත්) Withdrawal Database Model ---
const WithdrawalSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    accountName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    amount: { type: Number, required: true, default: 100 },
    status: { type: String, default: 'Pending' }, 
    requestedAt: { type: Date, default: Date.now }
});
const Withdrawal = mongoose.model('Withdrawal', WithdrawalSchema);


// --- Helper Function: Calculate Account Number ---
function calculateAccountNumber(accountName) {
    const baseNumber = 101051;
    const firstLetter = accountName.charAt(0).toUpperCase();
    if (firstLetter < 'A' || firstLetter > 'Z') {
        return null;
    }
    const letterPosition = firstLetter.charCodeAt(0) - 64;
    return baseNumber + letterPosition;
}

// --- API Endpoint for Registration ---
app.post('/api/register', async (req, res) => {
    try {
        const { accountName, password } = req.body;
        if (!accountName || !password || password.length < 6) {
            return res.status(400).json({ message: 'Invalid data.' });
        }
        const existingUser = await User.findOne({ accountName: accountName });
        if (existingUser) {
            return res.status(400).json({ message: 'Account name already taken.' });
        }
        const accountNumber = calculateAccountNumber(accountName);
        if (!accountNumber) {
            return res.status(400).json({ message: 'Account name must start with a letter (A-Z).' });
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = new User({
            accountName: accountName,
            password: hashedPassword,
            accountNumber: accountNumber
            // coins and upgrades will use default values
        });
        await newUser.save();
        res.status(201).json({
            message: 'User registered successfully!',
            accountNumber: newUser.accountNumber
        });
    } catch (error) {
        if (error.code === 11000) {
             return res.status(400).json({ message: 'An account with this name or account number already exists.' });
        }
        res.status(500).json({ message: 'Server error.' });
    }
});

// --- API Endpoint for LOGIN ---
app.post('/api/login', async (req, res) => {
    try {
        const { accountName, password } = req.body;
        const user = await User.findOne({ accountName: accountName });
        if (!user) {
            return res.status(400).json({ message: 'Invalid account name or password.' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid account name or password.' });
        }
        const token = jwt.sign(
            { id: user._id, accountName: user.accountName },
            JWT_SECRET,
            { expiresIn: '1d' }
        );
        res.status(200).json({
            message: 'Login successful!',
            token: token
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
});

// --- Authentication Middleware (ආරක්ෂක මුරකරුවා) ---
const protect = (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded; 
            next();
        } catch (error) {
            res.status(401).json({ message: 'Not authorized, token failed' });
        }
    }
    if (!token) {
        res.status(401).json({ message: 'Not authorized, no token' });
    }
};

// --- API Endpoint to GET USER DATA (Wallet/Garage) ---
app.get('/api/user-data', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json({
            accountName: user.accountName,
            accountNumber: user.accountNumber,
            balance: user.balance, // සැබෑ මුදල් (eZ Cash)
            coins: user.coins, // In-Game Currency
            upgrades: user.upgrades // Car Upgrades
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
});

// --- API Endpoint to BUY COINS (eZ Cash Sim) ---
// (පැරණි /api/reload එක, "Buy Coins" සඳහා නැවත යොදා ගනී)
app.post('/api/reload', protect, async (req, res) => {
    try {
        const { amount } = req.body; // මෙය LKR (සැබෑ මුදල්)
        const realMoneyAmount = Number(amount);
        
        if (!realMoneyAmount || realMoneyAmount <= 0) {
            return res.status(400).json({ message: 'Invalid amount.' });
        }
        
        // LKR 1 = 10 Coins (e.g., LKR 100 = 1000 Coins)
        const coinsToGive = realMoneyAmount * 10; 

        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            { 
                $inc: { 
                    balance: realMoneyAmount, // සැබෑ මුදල් Balance එක (Withdraw සඳහා)
                    coins: coinsToGive // In-Game Coins
                } 
            },
            { new: true }
        ).select('-password');
        
        res.status(200).json({
            message: `Reload successful! LKR ${realMoneyAmount} added to balance, and ${coinsToGive} Coins awarded!`,
            newBalance: updatedUser.balance,
            newCoins: updatedUser.coins
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
});

// --- (අලුත්) API Endpoint to UPGRADE RIMS (Normal Modify) ---
app.post('/api/upgrade-rims', protect, async (req, res) => {
    try {
        const cost = 1000; // 1000 Coins
        
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (user.coins < cost) {
            return res.status(400).json({ message: 'Not enough Coins! Go to Wallet to buy Coins.' });
        }

        // Coins අඩු කර, "Spinner" rims එකතු කිරීම
        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            { 
                $inc: { coins: -cost },
                'upgrades.rims': 'Spinner' // Rims update කිරීම
            },
            { new: true }
        ).select('-password');

        res.status(200).json({
            message: 'Upgrade Successful! "Spinner" Rims installed.',
            newCoins: updatedUser.coins,
            newUpgrades: updatedUser.upgrades
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// --- (අලුත්) API Endpoint to UPGRADE TURBO (Loku Upgrade / eZ Cash) ---
app.post('/api/upgrade-turbo', protect, async (req, res) => {
    try {
        const cost = 50; // LKR 50 (සැබෑ මුදල්)
        
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (user.balance < cost) {
            return res.status(400).json({ message: 'Not enough Real Money Balance (LKR 50)! Go to Wallet to Reload.' });
        }

        // LKR 50 (Balance) අඩු කර, "Turbo" එකතු කිරීම
        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            { 
                $inc: { balance: -cost },
                'upgrades.hasTurbo': true // Turbo update කිරීම
            },
            { new: true }
        ).select('-password');

        res.status(200).json({
            message: 'Loku Upgrade Successful! "Turbo" installed.',
            newBalance: updatedUser.balance,
            newUpgrades: updatedUser.upgrades
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// --- API Endpoint for WITHDRAWAL ---
app.post('/api/withdraw', protect, async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        const withdrawAmount = 100;
        const requiredBalance = 100000;

        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        // (අලුත්) Withdraw කරන්නේ In-Game Coins නොව, සැබෑ මුදල් Balance එකයි
        if (user.balance < requiredBalance) {
            return res.status(400).json({ message: `You need at least LKR ${requiredBalance} in your Real Money Balance to withdraw.` });
        }
        if (!phoneNumber || phoneNumber.length < 9) {
            return res.status(400).json({ message: 'Please enter a valid phone number.' });
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            { $inc: { balance: -requiredBalance } }, // සැබෑ මුදල් Balance එකෙන් අඩු කිරීම
            { new: true }
        ).select('-password');

        const newWithdrawal = new Withdrawal({
            userId: user._id,
            accountName: user.accountName,
            accountNumber: user.accountNumber,
            phoneNumber: phoneNumber,
            amount: withdrawAmount,
            status: 'Pending'
        });
        await newWithdrawal.save();
        
        res.status(200).json({
            message: `Withdrawal request for LKR ${withdrawAmount} submitted! You will receive a reload to ${phoneNumber} soon.`,
            newBalance: updatedUser.balance
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error.' });
    }
});


// --- Start the server ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Website available at: http://localhost:${PORT}/login.html (or your Railway/Replit URL)`);
});
