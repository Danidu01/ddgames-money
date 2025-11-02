// server.js (Car Racing Game Plan - FINAL)

// --- Imports ---
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); 
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path'); // HTML ගොනු serve කිරීමට අවශ්‍යයි

// --- App Setup ---
const app = express();
// (Railway/Replit සඳහා) PORT එක ස්වයංක්‍රීයව ලබා ගැනීම
const PORT = process.env.PORT || 3000; 

// --- Secrets (Railway/Replit "Variables" වෙතින් ලබා ගනී) ---
const JWT_SECRET = process.env.JWT_SECRET || 'your-default-secret-key-12345';
const atlasConnectionString = process.env.atlasConnectionString;
const OWNER_ACCOUNT_NAME = "Danidu Official"; // අයිතිකරුගේ ගිණුමේ නම

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

// --- (අලුත්) User Database Model (Car Speed ඇතුළත්) ---
const UserSchema = new mongoose.Schema({
    accountName: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    accountNumber: { type: Number, required: true, unique: true },
    balance: { type: Number, default: 0 },
    tickets: { type: Number, default: 0 },
    carSpeedLevel: { type: Number, default: 1 } // (අලුත්) 1 = Base speed
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
            // carSpeedLevel will use default '1'
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

// --- API Endpoint to GET USER DATA (Wallet) ---
app.get('/api/user-data', protect, async (req, res) => {
    try {
        // (අලුත්) Car Speed එකද select කිරීම
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json({
            accountName: user.accountName,
            accountNumber: user.accountNumber,
            balance: user.balance,
            tickets: user.tickets,
            carSpeedLevel: user.carSpeedLevel // (අලුත්)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
});

// --- API Endpoint to RELOAD BALANCE (Wallet) ---
app.post('/api/reload', protect, async (req, res) => {
    try {
        const { amount } = req.body;
        const reloadAmount = Number(amount);
        if (!reloadAmount || reloadAmount <= 0) {
            return res.status(400).json({ message: 'Invalid reload amount.' });
        }
        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            { $inc: { balance: reloadAmount } },
            { new: true }
        ).select('-password');
        res.status(200).json({
            message: 'Reload successful!',
            newBalance: updatedUser.balance
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
});

// --- API Endpoint to BUY TICKETS ---
app.post('/api/buy-tickets', protect, async (req, res) => {
    try {
        const cost = 500;
        const ticketsToBuy = 5;
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (user.balance < cost) {
            return res.status(400).json({ message: 'Not enough balance to buy tickets!' });
        }
        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            { 
                $inc: { 
                    balance: -cost, 
                    tickets: ticketsToBuy 
                } 
            },
            { new: true }
        ).select('-password');
        res.status(200).json({
            message: `Success! 5 tickets purchased for LKR ${cost}.`,
            newBalance: updatedUser.balance,
            newTicketCount: updatedUser.tickets
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
});

// --- API Endpoint to SPEND TICKETS (Car Race සඳහා) ---
app.post('/api/spend-ticket', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (user.tickets <= 0) {
            return res.status(400).json({ message: 'Not enough tickets to play the race!' });
        }
        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            { $inc: { tickets: -1 } },
            { new: true }
        ).select('-password');
        res.status(200).json({
            message: 'Ticket spent successfully. Good luck in the race!',
            newTicketCount: updatedUser.tickets
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
});

// --- (අලුත්) API Endpoint for CAR RACE COMPLETE ---
app.post('/api/race-complete', protect, async (req, res) => {
    try {
        const { rank } = req.body; // Frontend එකෙන් එවයි: 1, 2, 3, or 4+
        let prizeMoney = 0;
        let message = '';

        if (rank === 1) {
            prizeMoney = 500; // 1st Place
            message = 'Congratulations! You finished 1st and won LKR 500!';
        } else if (rank === 2) {
            prizeMoney = 250; // 2nd Place
            message = 'Great race! You finished 2nd and won LKR 250!';
        } else if (rank === 3) {
            prizeMoney = 100; // 3rd Place
            message = 'Good job! You finished 3rd and won LKR 100!';
        } else {
            prizeMoney = 0; // 4th, 5th, 6th
            message = 'Game Over. You finished outside the top 3. Better luck next time!';
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            { $inc: { balance: prizeMoney } },
            { new: true }
        ).select('-password');

        res.status(200).json({
            message: message,
            newBalance: updatedUser.balance
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// --- (අලුත්) API Endpoint to GET CAR DATA (Garage සඳහා) ---
app.get('/api/get-car-data', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('carSpeedLevel');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json({
            carSpeedLevel: user.carSpeedLevel
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error.' });
    }
});

// --- (අලුත්) API Endpoint to UPGRADE CAR (Garage/eZ Cash) ---
app.post('/api/upgrade-car', protect, async (req, res) => {
    try {
        const upgradeCost = 50; // LKR 50
        
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (user.balance < upgradeCost) {
            return res.status(400).json({ message: 'Not enough balance to upgrade! Reload first.' });
        }

        // LKR 50 අඩු කර, carSpeedLevel එක 1කින් වැඩි කිරීම
        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            { 
                $inc: { 
                    balance: -upgradeCost, 
                    carSpeedLevel: 1 
                } 
            },
            { new: true }
        ).select('-password');

        res.status(200).json({
            message: 'Upgrade Successful! Your car is now faster.',
            newBalance: updatedUser.balance,
            newCarSpeedLevel: updatedUser.carSpeedLevel
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
        if (user.balance < requiredBalance) {
            return res.status(400).json({ message: `You need at least LKR ${requiredBalance} to withdraw.` });
        }
        if (!phoneNumber || phoneNumber.length < 9) {
            return res.status(400).json({ message: 'Please enter a valid phone number.' });
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            { $inc: { balance: -requiredBalance } },
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
