const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor(dbPath = './bot_data.db') {
        this.db = new sqlite3.Database(dbPath);
        this.init();
    }
    
    init() {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id TEXT,
                side TEXT,
                type TEXT,
                entry_price REAL,
                size REAL,
                pnl REAL,
                timestamp INTEGER,
                exit_price REAL,
                exit_time INTEGER
            )
        `);
        
        this.db.run(`
            CREATE TABLE IF NOT EXISTS config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                config_data TEXT,
                updated_at INTEGER
            )
        `);
        
        this.db.run(`
            CREATE TABLE IF NOT EXISTS daily_stats (
                date TEXT PRIMARY KEY,
                pnl REAL,
                trade_count INTEGER,
                win_count INTEGER
            )
        `);
    }
    
    saveTrade(trade) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO trades (order_id, side, type, entry_price, size, pnl, timestamp, exit_price, exit_time)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [trade.orderId, trade.side, trade.type, trade.entryPrice, trade.size, trade.pnl || null, trade.timestamp, trade.exitPrice || null, trade.exitTime || null],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }
    
    saveConfig(config) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR REPLACE INTO config (id, config_data, updated_at) VALUES (1, ?, ?)`,
                [JSON.stringify(config), Date.now()],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }
    
    getConfig() {
        return new Promise((resolve, reject) => {
            this.db.get(`SELECT config_data FROM config WHERE id = 1`, (err, row) => {
                if (err) reject(err);
                else resolve(row ? JSON.parse(row.config_data) : null);
            });
        });
    }
    
    updateDailyStats(date, pnl, tradeCount, winCount) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR REPLACE INTO daily_stats (date, pnl, trade_count, win_count) VALUES (?, ?, ?, ?)`,
                [date, pnl, tradeCount, winCount],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }
    
    close() {
        this.db.close();
    }
}

module.exports = Database;
