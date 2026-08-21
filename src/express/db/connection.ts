import mongoose from 'mongoose';

const RETRY_INTERVAL_MS = 5000;

/**
 * Whether the database is currently usable
 * @returns `true` if connected, `false` otherwise
 */
export function isConnected(): boolean {
    return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
}

/**
 * Connects to the database, retrying until it succeeds. Does nothing if a
 * connection is already open or being opened.
 * @param uri The connection string
 * @param retryMs How long to wait before another attempt
 */
export async function connect(
    uri: string,
    retryMs: number = RETRY_INTERVAL_MS
): Promise<void> {
    if (mongoose.connection.readyState !== mongoose.ConnectionStates.disconnected) {
        return;
    }

    try {
        await mongoose.connect(uri);
    }
    catch (err) {
        // Only the error name, since the message can carry the connection string
        const name = err instanceof Error ? err.name : 'unknown error';

        console.error(`Database connection failed (${name}), retrying`);
        setTimeout(() => void connect(uri, retryMs), retryMs);
    }
}

/**
 * Reconnects whenever the database drops the connection
 * @param uri The connection string
 */
export function reconnectOnDisconnect(uri: string): void {
    mongoose.connection.on('disconnected', () => void connect(uri));
}
