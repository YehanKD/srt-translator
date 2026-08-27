import { readFileSync } from 'fs';

const [, , wsUrlFile, exprFile] = process.argv;
const url = readFileSync(wsUrlFile, 'utf8').trim();
const { expression } = JSON.parse(readFileSync(exprFile, 'utf8'));

const ws = new WebSocket(url);
let done = false;
ws.onopen = () => {
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
};
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id === 1) {
    try {
      if (msg.result?.exceptionDetails) {
        console.log('EXC:', msg.result.exceptionDetails.exception?.description || msg.result.exceptionDetails.text);
      } else {
        console.log('VAL:', JSON.stringify(msg.result?.result?.value ?? msg.result));
      }
    } catch { console.log('RAW:', JSON.stringify(msg).slice(0,1500)); }
    done = true;
    ws.close();
  }
};
setTimeout(() => { if (!done) { console.log('TIMEOUT'); ws.close(); } }, 20000);