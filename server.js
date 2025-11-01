const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path'); // HTML ගොනු serve කිරීමට අවශ්‍යයි

const app = express();
// Replit හි host කිරීමට මෙම වෙනස අවශ්‍යයි
const PORT = process.env.PORT || 3000; 
const JWT_SECRET = 'your-very-strong-secret-key-12345';
const OWNER_ACCOUNT_NAME = "Danidu Official"; // අයිතිකරුගේ ගිණුමේ නම

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- (අලුත්) HTML, CSS, JS ගොනු Serve කිරීම ---
// server.js ගොනුව ඇති ෆෝල්ඩරයේම ඇති සියලුම .html ගොනු serve කරන්න
app.use(express.static(path.join(__dirname)));

// --- Database Connection (MongoDB Atlas) ---
// Replit හි host කිරීමට, මෙම connection string එක "Secrets" (Environment Variables) එකකට දමන්න
// const atlasConnectionString = 'mongodb+srv://Danidu_Official:DD%40999Admin@cluster0.gakhyma.mongodb.net/ddGamesMoney?appName=Cluster0';

// Replit Secrets (Environment Variables) වෙතින් connection string එක ලබා ගැනීම
const atlasConnectionString = process.env.atlasConnectionString;

// Replit Secrets වෙතින් JWT Secret එක ලබා ගැනීම
const effectiveJwtSecret = process.env.JWT_SECRET || JWT_SECRET;


mongoose.connect(atlasConnectionString)
    .then(() => console.log('MongoDB Atlas connected...'))
    .catch(err => {
        console.error("MongoDB Connection Error:", err.message);
        if (err.code === 8000) {
            console.error("   >>> Authentication Failed. Please check username/password in connection string.");
        }
        if (err.name === 'MongooseServerSelectionError') {
             console.error("   >>> Network Error. Cannot find host. Check internet connection or DNS settings.");
        }
    });

// --- User Database Model ---
const UserSchema = new mongoose.Schema({
    accountName: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    accountNumber: { type: Number, required: true, unique: true },
    balance: { type: Number, default: 0 },
    tickets: { type: Number, default: 0 }
});
const User = mongoose.model('User', UserSchema);

// --- (අලුත්) Withdrawal Database Model ---
const WithdrawalSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    accountName: { type: String, required: true },
    accountNumber: { type: Number, required: true },
    phoneNumber: { type: String, required: true }, // Reload එක යැවිය යුතු අංකය
    amount: { type: Number, required: true, default: 100 },
    status: { type: String, default: 'Pending' }, // e.g., Pending, Completed
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
            effectiveJwtSecret, // Replit Secret එක භාවිතා කිරීම
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
            const decoded = jwt.verify(token, effectiveJwtSecret); // Replit Secret එක භාවිතා කිරීම
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
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json({
            accountName: user.accountName,
            accountNumber: user.accountNumber,
            balance: user.balance,
            tickets: user.tickets
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

// --- API Endpoint to EARN TICKETS ---
app.post('/api/earn-tickets', protect, async (req, res) => {
    try {
        const ticketsToAward = 3;
        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            { $inc: { tickets: ticketsToAward } },
            { new: true }
        ).select('-password');
        if (!updatedUser) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json({
            message: '3 tickets awarded successfully!',
            newTicketCount: updatedUser.tickets
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// --- API Endpoint to SPEND TICKETS ---
app.post('/api/spend-ticket', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (user.tickets <= 0) {
            return res.status(400).json({ message: 'Not enough tickets to play!' });
        }
        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            { $inc: { tickets: -1 } },
            { new: true }
        ).select('-password');
        res.status(200).json({
            message: 'Ticket spent successfully. Good luck!',
            newTicketCount: updatedUser.tickets
        });
    } catch (error) {
        console.error(error);
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
        console.error(error);
        res.status(500).json({ message: 'Server error.' });
    }
});


// --- API Endpoint for FIGHT GAME BET ---
app.post('/api/fight-bet', protect, async (req, res) => {
    try {
        const { betAmount, won } = req.body;
        const bet = Number(betAmount);
        
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (user.balance < bet) {
            return res.status(400).json({ message: 'Not enough balance for this bet!' });
        }

        let newBalance;
        let message;

        if (won) {
            // දිනුවොත්: Bet එක මෙන් දෙගුණයක් (Player's bet + Opponent's bet) දිනයි
            // Net result: Balance + bet
            newBalance = user.balance + bet;
            message = `You Won! You received LKR ${bet * 2} (your ${bet} + opponent's ${bet}).`;
            
            await User.findByIdAndUpdate(req.user.id, { $inc: { balance: bet } });

        } else {
            // පැරදුනොත්: Bet කළ මුදල අහිමි වේ
            newBalance = user.balance - bet;
            message = `You Lost! You lost your bet of LKR ${bet}.`;
            
            await User.findByIdAndUpdate(req.user.id, { $inc: { balance: -bet } });

            // --- Owner's Commission Logic ---
            const commission = bet * 0.02; // 2% commission
            
            // "Danidu Official" ගිණුම සොයා, 2% commission එක එකතු කිරීම
            await User.findOneAndUpdate(
                { accountName: OWNER_ACCOUNT_NAME },
                { $inc: { balance: commission } }
            );
        }

        res.status(200).json({
            message: message,
            newBalance: newBalance
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
        const withdrawAmount = 100; // ත්‍යාග මුදල
        const requiredBalance = 100000; // අවශ්‍ය ශේෂය

        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (user.balance < requiredBalance) {
            return res.status(400).json({ message: 'You need at least LKR 100,000 to withdraw.' });
        }
        if (!phoneNumber || phoneNumber.length < 9) { // Basic phone number validation
            return res.status(400).json({ message: 'Please enter a valid phone number.' });
        }

        // 1. පරිශීලකයාගේ Balance එකෙන් LKR 100,000 අඩු කිරීම
        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            { $inc: { balance: -requiredBalance } },
            { new: true }
        ).select('-password');

        // 2. "Withdrawals" collection එකේ අලුත් request එකක් සටහන් කිරීම
        const newWithdrawal = new Withdrawal({
            userId: user._id,
            accountName: user.accountName,
            accountNumber: user.accountNumber,
            phoneNumber: phoneNumber,
            amount: withdrawAmount,
            status: 'Pending' // Admin විසින් මෙය 'Completed' කළ යුතුය
        });
        await newWithdrawal.save();
        
        // 3. Frontend එකට සාර්ථක පණිවිඩය යැවීම
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
    console.log(`Server running on http://localhost:${PORT}`);
    // Replit.com හිදී, public URL එක ස්වයංක්‍රීයව පෙන්වයි
});
