const axios = require('axios');
const { ClobClient } = require('@polymarket/clob-client');
const { ethers } = require('ethers');

class PolymarketService {
    constructor(config) {
        this.config = config;
        this.clobClient = null;
        this.gammaApi = config.gammaApiUrl;
        this.clobApi = config.clobApiUrl;
        this.wallet = new ethers.Wallet(config.privateKey);
        this.initialized = false;
    }
    
    async initialize() {
        try {
            this.clobClient = new ClobClient(
                this.clobApi,
                137, // Polygon chain ID
                this.wallet,
                undefined, // API creds will be derived
                0, // Signature type (EOA)
                this.config.proxyAddress
            );
            
            // Derive API credentials
            await this.clobClient.deriveApiKey();
            this.initialized = true;
            console.log('Polymarket client initialized');
        } catch (error) {
            console.error('Failed to initialize Polymarket client:', error);
            throw error;
        }
    }
    
    async getCurrentBTCMarket(interval = 15) {
        // Generate market slug based on current time
        const now = new Date();
        const roundedTime = this.roundToInterval(now, interval);
        const slug = `btc-updown-${interval}m-${Math.floor(roundedTime / 1000)}`;
        
        try {
            const response = await axios.get(`${this.gammaApi}/markets`, {
                params: { slug: slug }
            });
            
            if (response.data && response.data.length > 0) {
                const market = response.data[0];
                return this.parseMarketData(market);
            }
            return null;
        } catch (error) {
            console.error('Error fetching market:', error);
            return null;
        }
    }
    
    async getMarketPrices(tokenId) {
        try {
            const orderbook = await this.clobClient.getOrderBook(tokenId);
            const bestBid = orderbook.bids && orderbook.bids[0] ? parseFloat(orderbook.bids[0].price) : 0;
            const bestAsk = orderbook.asks && orderbook.asks[0] ? parseFloat(orderbook.asks[0].price) : 0;
            
            return {
                bid: bestBid,
                ask: bestAsk,
                mid: (bestBid + bestAsk) / 2,
                spread: bestAsk - bestBid,
                liquidity: orderbook.bids?.length + orderbook.asks?.length || 0
            };
        } catch (error) {
            console.error('Error fetching prices:', error);
            return null;
        }
    }
    
    async placeOrder(tokenId, side, amount, price) {
        if (!this.initialized) {
            await this.initialize();
        }
        
        try {
            // Convert amount to shares (assuming $1 per share)
            const shares = amount;
            const size = shares; // Size in shares
            const priceNum = parseFloat(price);
            
            const order = await this.clobClient.postOrder({
                tokenID: tokenId,
                side: side.toUpperCase(),
                price: priceNum,
                size: size,
                feeRateBps: 0
            });
            
            return {
                success: true,
                orderId: order.orderID,
                price: priceNum,
                size: size,
                side: side
            };
        } catch (error) {
            console.error('Error placing order:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    async getBalance() {
        try {
            const usdcBalance = await this.getTokenBalance(
                '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' // USDC.e on Polygon
            );
            return {
                usdc: parseFloat(ethers.utils.formatUnits(usdcBalance, 6)),
                matic: parseFloat(ethers.utils.formatUnits(await this.getMaticBalance(), 18))
            };
        } catch (error) {
            console.error('Error fetching balance:', error);
            return null;
        }
    }
    
    async getTokenBalance(tokenAddress) {
        const contract = new ethers.Contract(
            tokenAddress,
            ['function balanceOf(address) view returns (uint256)'],
            this.wallet
        );
        return await contract.balanceOf(this.wallet.address);
    }
    
    async getMaticBalance() {
        return await this.wallet.getBalance();
    }
    
    roundToInterval(date, minutes) {
        const ms = minutes * 60 * 1000;
        return Math.floor(date.getTime() / ms) * ms;
    }
    
    parseMarketData(market) {
        const upToken = market.clobTokenIds[0];
        const downToken = market.clobTokenIds[1];
        
        return {
            id: market.id,
            slug: market.slug,
            question: market.question,
            conditionId: market.conditionId,
            tokens: {
                up: upToken,
                down: downToken
            },
            endDate: new Date(market.endDate),
            volume: market.volume,
            liquidity: market.liquidity
        };
    }
}

module.exports = { PolymarketService };
