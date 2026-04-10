require('dotenv').config();
const { PolymarketService } = require('./services/polymarket');
const { TwoLegReversalStrategy } = require('./strategies/twoLeg');
const { TradingEngine } = require('./services/trading');
const { DashboardServer } = require('./dashboard/server');

async function main() {
    console.log('🤖 Starting Polymarket BTC Up/Down Trading Bot...');
    
    // Configuration
    const config = {
        interval: 15, // 15-minute markets
        stakeUSD: parseFloat(process.env.DEFAULT_STAKE_USD) || 10,
        maxPositions: parseInt(process.env.MAX_POSITIONS) || 5,
        maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS) || 50,
        minLiquidity: 2000,
        cycleSeconds: 60,
        sumTarget: 0.95,
        movePct: 0.15,
        windowMin: 2
    };
    
    // Initialize services
    const polymarket = new PolymarketService({
        privateKey: process.env.PRIVATE_KEY,
        proxyAddress: process.env.POLYMARKET_PROXY_ADDRESS,
        gammaApiUrl: process.env.GAMMA_API_URL || 'https://gamma-api.polymarket.com',
        clobApiUrl: process.env.CLOB_API_URL || 'https://clob.polymarket.com'
    });
    
    await polymarket.initialize();
    
    const strategy = new TwoLegReversalStrategy(config);
    const tradingEngine = new TradingEngine(polymarket, strategy, config);
    
    // Start dashboard
    const dashboard = new DashboardServer(tradingEngine, polymarket, parseInt(process.env.DASHBOARD_PORT) || 3000);
    dashboard.start();
    
    // Start trading engine
    console.log('Starting trading engine...');
    tradingEngine.start().catch(console.error);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\nShutting down...');
        tradingEngine.stop();
        process.exit(0);
    });
}

main().catch(console.error);
