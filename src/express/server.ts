import app from './app';
import { connect, reconnectOnDisconnect } from './db/connection';
import { msgBoard } from './env';

const port = 3000;

reconnectOnDisconnect(msgBoard.uri);
void connect(msgBoard.uri);

app.listen(port, () => {
    console.log('Server is running!');
});
