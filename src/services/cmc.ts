import axios, { AxiosRequestConfig } from 'axios';

// --- OUTPUT INTERFACE (Still needed for type-safe return) ---

export interface CmcPrices {
    ethPriceUSD: number;
    solPriceUSD: number;
}

// --- CMC SERVICE CLASS ---

export class CmcService {
    private readonly API_KEY: string;
    private readonly BASE_URL: string = "https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest";
    
    // CMC IDs for ETH and SOL
    private readonly ETH_ID: string = "1027"; 
    private readonly SOL_ID: string = "5426"; 

    cachedEthPrice?: number;
    cachedSolPrice?: number;

    constructor() {
        // Read API key directly from environment variable
        const apiKey = process.env.CMC_API_KEY;
        
        if (!apiKey) {
            throw new Error("CMC API Key is required. Please set the CMC_API_KEY environment variable.");
        }
        this.API_KEY = apiKey;
    }

    /**
     * Fetches the latest ETH and SOL prices from the CoinMarketCap Pro API
     * and extracts the USD price for each.
     * @returns {Promise<CmcPrices>} An object containing ethPriceUSD and solPriceUSD.
     */
    public async getEthAndSolPriceInUSD(iteration: number): Promise<CmcPrices> {

        if (this.cachedEthPrice && this.cachedSolPrice && iteration % 100 !== 0) {
            return {
                 ethPriceUSD: this.cachedEthPrice, 
                 solPriceUSD: this.cachedSolPrice
            };
        }

        const ids = `${this.ETH_ID},${this.SOL_ID}`;

        const requestConfig: AxiosRequestConfig = {
            method: 'GET',
            url: this.BASE_URL,
            params: {
                id: ids,
                aux: 'num_market_pairs', 
            },
            headers: {
                'X-CMC_PRO_API_KEY': this.API_KEY,
                'Accept': 'application/json',
                'Accept-Encoding': 'deflate, gzip'
            }
        };

        try {
            // Use 'any' to avoid defining deep JSON structure
            const response = await axios.request<any>(requestConfig);
            const data = response.data.data;

            // Error Check
            if (response.data.status.error_code !== 0) {
                throw new Error(`CMC API Error: ${response.data.status.error_message || 'Unknown error'}`);
            }

            // Extract ETH Price using bracket notation (safer for dynamic properties)
            const ethData = data[this.ETH_ID];
            if (!ethData || !ethData.quote.USD.price) {
                throw new Error("ETH price data (ID 1027) not found or missing price field.");
            }
            const ethPriceUSD = ethData.quote.USD.price;

            // Extract SOL Price
            const solData = data[this.SOL_ID];
            if (!solData || !solData.quote.USD.price) {
                throw new Error("SOL price data (ID 5426) not found or missing price field.");
            }
            const solPriceUSD = solData.quote.USD.price;
            
            console.log(`CMC Prices fetched: ETH $${ethPriceUSD.toFixed(2)}, SOL $${solPriceUSD.toFixed(2)}`);
            this.cachedEthPrice = ethPriceUSD;
            this.cachedSolPrice = solPriceUSD;

            return {
                ethPriceUSD,
                solPriceUSD
            };

        } catch (error) {
            console.error("Error fetching CMC prices:", error);
            throw new Error("Failed to retrieve cryptocurrency prices from CMC.");
        }
    }
}