class BaseStrategy {
    constructor(config) {
        this.config = config;
        this.activePositions = new Map();
        this.dailyPnL = 0;
        this.dailyLoss = 0;
    }

    async shouldEnter(marketData, context) {
        throw new Error('shouldEnter must be implemented');
    }

    async shouldExit(position, marketData) {
        throw new Error('shouldExit must be implemented');
    }

    async calculatePositionSize(marketData, confidence) {
        const baseSize = this.config.stakeUSD || 10;
        const multiplier = Math.min(1.5, confidence / 0.5);
        return baseSize * multiplier;
    }

    validateRiskLimits(position, marketData) {
        // Check max positions
        if (this.activePositions.size >= this.config.maxPositions) {
            return { allowed: false, reason: 'Max positions reached' };
        }

        // Check daily loss limit
        if (this.dailyLoss >= this.config.maxDailyLoss) {
            return { allowed: false, reason: 'Daily loss limit exceeded' };
        }

        // Check min liquidity
        if (marketData.liquidity < this.config.minLiquidity) {
            return { allowed: false, reason: 'Insufficient liquidity' };
        }

        return { allowed: true };
    }

    updatePnL(amount) {
        this.dailyPnL += amount;
        if (amount < 0) {
            this.dailyLoss += Math.abs(amount);
        }
    }

    getStats() {
        return {
            activePositions: this.activePositions.size,
            dailyPnL: this.dailyPnL,
            dailyLoss: this.dailyLoss,
            config: this.config
        };
    }
}

module.exports = { BaseStrategy };
