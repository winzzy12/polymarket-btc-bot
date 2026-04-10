const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');
const Database = require('../database/storage');

class DashboardServer {
    constructor(tradingEngine, polymarketService, port = 3000) {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIO(this.server, {
            cors: { origin: '*', methods: ['GET', 'POST'] }
        });
        
        this.port = port;
        this.tradingEngine = tradingEngine;
        this.polymarket = polymarketService;
        this.db = new Database();
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSocket();
        this.setupEventListeners();
    }
    
    setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, 'public')));
    }
    
    setupRoutes() {
        // Get bot status
        this.app.get('/api/status', async (req, res) => {
            const stats = this.tradingEngine.getStats();
            const balance = await this.polymarket.getBalance();
            res.json({
                running: this.tradingEngine.isRunning,
                stats: stats,
                balance: balance,
                config: this.tradingEngine.config
            });
        });
        
        // Get strategy config
        this.app.get('/api/strategy', (req, res) => {
            res.json(this.tradingEngine.strategy.config);
        });
        
        // Update strategy config
        this.app.post('/api/strategy', (req, res) => {
            const newConfig = req.body;
            this.tradingEngine.strategy.updateConfig(newConfig);
            this.tradingEngine.config = { ...this.tradingEngine.config, ...newConfig };
            this.db.saveConfig(newConfig);
            res.json({ success: true, config: this.tradingEngine.strategy.config });
        });
        
        // Get trade history
        this.app.get('/api/trades', (req, res) => {
            const limit = parseInt(req.query.limit) || 100;
            const trades = this.tradingEngine.tradeHistory.slice(-limit);
            res.json(trades);
        });
        
        // Start/Stop bot
        this.app.post('/api/control', async (req, res) => {
            const { action } = req.body;
            if (action === 'start') {
                if (!this.tradingEngine.isRunning) {
                    this.tradingEngine.start().catch(console.error);
                }
                res.json({ success: true, running: true });
            } else if (action === 'stop') {
                this.tradingEngine.stop();
                res.json({ success: true, running: false });
            } else {
                res.status(400).json({ error: 'Invalid action' });
            }
        });
        
        // Get market data
        this.app.get('/api/market', async (req, res) => {
            const market = await this.polymarket.getCurrentBTCMarket(this.tradingEngine.config.interval);
            if (market) {
                const upPrices = await this.polymarket.getMarketPrices(market.tokens.up);
                const downPrices = await this.polymarket.getMarketPrices(market.tokens.down);
                res.json({
                    market: market,
                    prices: { up: upPrices, down: downPrices }
                });
            } else {
                res.status(404).json({ error: 'Market not found' });
            }
        });
    }
    
    setupWebSocket() {
        this.io.on('connection', (socket) => {
            console.log('Client connected');
            
            socket.on('subscribe', (channel) => {
                socket.join(channel);
            });
            
            socket.on('disconnect', () => {
                console.log('Client disconnected');
            });
        });
    }
    
    setupEventListeners() {
        this.tradingEngine.on('position_opened', (position) => {
            this.io.emit('position_opened', position);
        });
        
        this.tradingEngine.on('position_closed', (data) => {
            this.io.emit('position_closed', data);
        });
        
        this.tradingEngine.on('cycle_complete', (data) => {
            this.io.emit('cycle_complete', data);
        });
        
        this.tradingEngine.on('cycle_start', (data) => {
            this.io.emit('cycle_start', data);
        });
    }
    
    start() {
        this.server.listen(this.port, () => {
            console.log(`Dashboard running at http://localhost:${this.port}`);
        });
    }
}

module.exports = { DashboardServer };
