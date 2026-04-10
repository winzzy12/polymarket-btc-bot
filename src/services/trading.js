const EventEmitter = require('events');

class TradingEngine extends EventEmitter {
    constructor(polymarketService, strategy, config) {
        super();
        this.polymarket = polymarketService;
        this.strategy = strategy;
        this.config = config;
        this.activeOrders = new Map();
        this.tradeHistory = [];
        this.isRunning = false;
        this.currentCycle = null;
    }
    
    async start() {
        this.isRunning = true;
        console.log('Trading engine started');
        
        while (this.isRunning) {
            try {
                await this.runCycle();
                await this.sleep(this.config.cycleSeconds * 1000);
            } catch (error) {
                console.error('Cycle error:', error);
                this.emit('error', error);
            }
        }
    }
    
    stop() {
        this.isRunning = false;
        console.log('Trading engine stopped');
        this.emit('stopped');
    }
    
    async runCycle() {
        this.emit('cycle_start', { timestamp: Date.now() });
        
        // Get current market
        const market = await this.polymarket.getCurrentBTCMarket(this.config.interval);
        if (!market) {
            this.emit('cycle_error', { error: 'No market found' });
            return;
        }
        
        // Get current prices
        const upPrices = await this.polymarket.getMarketPrices(market.tokens.up);
        const downPrices = await this.polymarket.getMarketPrices(market.tokens.down);
        
        if (!upPrices || !downPrices) {
            this.emit('cycle_error', { error: 'Failed to fetch prices' });
            return;
        }
        
        const marketData = {
            roundId: market.id,
            roundStartTime: this.getRoundStartTime(),
            timeRemaining: Math.max(0, (market.endDate - Date.now()) / 1000),
            upPrice: upPrices.ask,
            downPrice: downPrices.ask,
            upBid: upPrices.bid,
            downBid: downPrices.bid,
            spread: (upPrices.spread + downPrices.spread) / 2,
            liquidity: Math.min(upPrices.liquidity, downPrices.liquidity),
            timestamp: Date.now()
        };
        
        // Check for entry signals
        const entrySignal = await this.strategy.shouldEnter(marketData, {});
        
        if (entrySignal.shouldEnter) {
            await this.executeEntry(entrySignal, market);
        }
        
        // Check existing positions for exit signals
        for (const [positionId, position] of this.strategy.activePositions) {
            const exitSignal = await this.strategy.shouldExit(position, marketData);
            
            if (exitSignal.shouldExit) {
                await this.executeExit(position, market);
            } else if (exitSignal.shouldHedge) {
                await this.executeHedge(position, exitSignal, market);
            }
        }
        
        this.emit('cycle_complete', {
            timestamp: Date.now(),
            marketData,
            entrySignal,
            activePositions: this.strategy.activePositions.size
        });
    }
    
    async executeEntry(signal, market) {
        const tokenId = signal.side === 'UP' ? market.tokens.up : market.tokens.down;
        const positionSize = await this.strategy.calculatePositionSize(
            { up: signal.price, down: 1 - signal.price },
            0.7
        );
        
        const riskCheck = this.strategy.validateRiskLimits(signal, {
            liquidity: signal.liquidity || 2000
        });
        
        if (!riskCheck.allowed) {
            this.emit('entry_denied', { reason: riskCheck.reason, signal });
            return;
        }
        
        const order = await this.polymarket.placeOrder(
            tokenId,
            signal.side,
            positionSize,
            signal.price
        );
        
        if (order.success) {
            const position = {
                id: order.orderId,
                side: signal.side,
                type: signal.type || 'ENTRY',
                entryPrice: order.price,
                size: order.size,
                tokenId: tokenId,
                marketId: market.id,
                timestamp: Date.now()
            };
            
            this.strategy.activePositions.set(order.orderId, position);
            this.tradeHistory.push({ ...position, type: 'BUY' });
            
            this.emit('position_opened', position);
        } else {
            this.emit('entry_failed', { error: order.error, signal });
        }
    }
    
    async executeExit(position, market) {
        const tokenId = position.tokenId;
        
        // Get current price
        const prices = await this.polymarket.getMarketPrices(tokenId);
        if (!prices) return;
        
        const currentPrice = prices.bid; // Exit at bid price
        const pnl = (currentPrice - position.entryPrice) * position.size;
        
        // Place exit order
        const order = await this.polymarket.placeOrder(
            tokenId,
            position.side === 'UP' ? 'DOWN' : 'UP', // Opposite side to close
            position.size,
            currentPrice
        );
        
        if (order.success) {
            this.strategy.activePositions.delete(position.id);
            this.strategy.updatePnL(pnl);
            
            this.tradeHistory.push({
                ...position,
                exitPrice: currentPrice,
                pnl: pnl,
                type: 'SELL',
                exitTime: Date.now()
            });
            
            this.emit('position_closed', { position, pnl });
        }
    }
    
    async executeHedge(position, signal, market) {
        const tokenId = signal.hedgeSide === 'UP' ? market.tokens.up : market.tokens.down;
        
        const order = await this.polymarket.placeOrder(
            tokenId,
            signal.hedgeSide,
            position.size,
            signal.hedgePrice
        );
        
        if (order.success) {
            const hedgePosition = {
                id: order.orderId,
                side: signal.hedgeSide,
                type: 'LEG2',
                entryPrice: order.price,
                size: order.size,
                tokenId: tokenId,
                marketId: market.id,
                timestamp: Date.now(),
                hedgeOf: position.id
            };
            
            this.strategy.activePositions.set(order.orderId, hedgePosition);
            this.tradeHistory.push({ ...hedgePosition, type: 'HEDGE' });
            
            this.emit('hedge_placed', hedgePosition);
        }
    }
    
    getRoundStartTime() {
        const now = new Date();
        const minutes = this.config.interval;
        const ms = minutes * 60 * 1000;
        return Math.floor(now.getTime() / ms) * ms;
    }
    
    getStats() {
        const closedTrades = this.tradeHistory.filter(t => t.pnl !== undefined);
        const winningTrades = closedTrades.filter(t => t.pnl > 0);
        const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        
        return {
            totalTrades: this.tradeHistory.length,
            closedTrades: closedTrades.length,
            winningTrades: winningTrades.length,
            winRate: closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0,
            totalPnl: totalPnl,
            activePositions: this.strategy.activePositions.size,
            strategyStats: this.strategy.getStats(),
            engineRunning: this.isRunning
        };
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { TradingEngine };
