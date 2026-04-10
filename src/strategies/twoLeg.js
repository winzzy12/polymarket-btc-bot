const { BaseStrategy } = require('./base');

class TwoLegReversalStrategy extends BaseStrategy {
    constructor(config) {
        super(config);
        this.name = 'Two-Leg Reversal';
        this.leg1Entries = new Map(); // Track leg1 entries per round
        this.roundState = new Map(); // Track state per round
    }

    async shouldEnter(marketData, context) {
        const { roundId, upPrice, downPrice, timestamp, roundStartTime } = marketData;
        
        // Initialize round state if not exists
        if (!this.roundState.has(roundId)) {
            this.roundState.set(roundId, {
                leg1Triggered: false,
                leg1Side: null,
                leg1Price: null,
                leg1Time: null
            });
        }
        
        const state = this.roundState.get(roundId);
        
        // Only trigger Leg1 within windowMin minutes of round start
        const minutesSinceStart = (timestamp - roundStartTime) / 60000;
        if (minutesSinceStart > this.config.windowMin) {
            return { shouldEnter: false, reason: 'Outside entry window' };
        }
        
        // Check for dump (price drop)
        if (!state.leg1Triggered) {
            const dropDetected = this.detectDump(marketData, this.config.movePct);
            
            if (dropDetected) {
                const side = dropDetected.side;
                const price = dropDetected.price;
                
                state.leg1Triggered = true;
                state.leg1Side = side;
                state.leg1Price = price;
                state.leg1Time = timestamp;
                
                return {
                    shouldEnter: true,
                    side: side,
                    price: price,
                    type: 'LEG1',
                    reason: `Dump detected on ${side} side`
                };
            }
        }
        
        return { shouldEnter: false, reason: 'No dump detected' };
    }
    
    async shouldExit(position, marketData) {
        const { roundId, upPrice, downPrice } = marketData;
        const state = this.roundState.get(roundId);
        
        if (!state || !state.leg1Triggered) {
            return { shouldExit: false };
        }
        
        // Check if we can trigger Leg2 (hedge)
        if (position.type === 'LEG1' && !state.leg2Triggered) {
            const leg1Price = state.leg1Price;
            const oppositePrice = state.leg1Side === 'UP' ? downPrice : upPrice;
            const sum = leg1Price + oppositePrice;
            
            if (sum <= this.config.sumTarget) {
                state.leg2Triggered = true;
                state.leg2Side = state.leg1Side === 'UP' ? 'DOWN' : 'UP';
                state.leg2Price = oppositePrice;
                
                return {
                    shouldExit: false,
                    shouldHedge: true,
                    hedgeSide: state.leg2Side,
                    hedgePrice: oppositePrice,
                    reason: `Hedge triggered: ${leg1Price.toFixed(3)} + ${oppositePrice.toFixed(3)} = ${sum.toFixed(3)} <= ${this.config.sumTarget}`
                };
            }
        }
        
        // Check if round is ending (last 30 seconds)
        const { timeRemaining } = marketData;
        if (timeRemaining <= 30 && timeRemaining > 0) {
            return {
                shouldExit: true,
                reason: 'Round ending soon'
            };
        }
        
        return { shouldExit: false };
    }
    
    detectDump(marketData, thresholdPercent) {
        const { priceHistory, upPrice, downPrice } = marketData;
        
        if (!priceHistory || priceHistory.length < 2) {
            return null;
        }
        
        const lastPrice = priceHistory[priceHistory.length - 1];
        const previousPrice = priceHistory[priceHistory.length - 2];
        
        // Check for rapid drop in 3 seconds
        const timeDelta = (lastPrice.timestamp - previousPrice.timestamp) / 1000;
        if (timeDelta <= 3) {
            const upDrop = previousPrice.up - lastPrice.up;
            const downDrop = previousPrice.down - lastPrice.down;
            
            if (upDrop >= thresholdPercent && upDrop > 0) {
                return { side: 'UP', price: lastPrice.up, drop: upDrop };
            }
            if (downDrop >= thresholdPercent && downDrop > 0) {
                return { side: 'DOWN', price: lastPrice.down, drop: downDrop };
            }
        }
        
        return null;
    }
    
    cleanupRound(roundId) {
        this.roundState.delete(roundId);
    }
    
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }
}

module.exports = { TwoLegReversalStrategy };
