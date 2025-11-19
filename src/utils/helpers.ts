export const setupLogger = () => {
    const originalLog = console.log;
    const originalError = console.error;

    console.log = (...args: any[]) => {
        const timestamp = new Date().toISOString();
        originalLog(`[${timestamp}]`, ...args);
    };

    console.error = (...args: any[]) => {
        const timestamp = new Date().toISOString();
        originalError(`[${timestamp}]`, ...args);
    };
};

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
