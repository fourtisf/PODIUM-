// TEST HELPER ONLY. LiteSVM runs in this worker thread, never on the test's own thread: after it
// executes a program the calling thread's x87 floating-point state is left dirty, and V8 then
// computes `a % b` on non-integer doubles as NaN (and crypto.randomInt never returns). Keeping
// the VM on its own thread keeps that away from the code under test.
// Plain CommonJS so the worker needs no TypeScript loader.
const { parentPort } = require('node:worker_threads');
const { Clock, FailedTransactionMetadata, LiteSVM } = require('litesvm');
const { PublicKey, Transaction } = require('@solana/web3.js');

// Blockhash expiry is simulated by the caller (by block height).
const svm = new LiteSVM().withBlockhashCheck(false);

const handlers = {
  addProgram: ([programId, path]) => svm.addProgramFromFile(new PublicKey(programId), path),
  airdrop: ([address, lamports]) => void svm.airdrop(new PublicKey(address), lamports),
  rent: ([bytes]) => svm.minimumBalanceForRentExemption(BigInt(bytes)),
  getAccount: ([address]) => {
    const a = svm.getAccount(new PublicKey(address));
    return a ? { data: Uint8Array.from(a.data), owner: a.owner.toBase58() } : null;
  },
  latestBlockhash: () => svm.latestBlockhash(),
  expireBlockhash: () => svm.expireBlockhash(),
  getClock: () => svm.getClock().unixTimestamp,
  setClock: ([unix]) => {
    const c = svm.getClock();
    svm.setClock(new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, unix));
  },
  // One transaction = one block. A failure is reported like a failed preflight: nothing lands.
  send: ([raw]) => {
    const res = svm.sendTransaction(Transaction.from(Buffer.from(raw)));
    svm.expireBlockhash();
    if (res instanceof FailedTransactionMetadata) return { ok: false, logs: res.meta().logs(), error: res.toString() };
    return { ok: true, logs: res.logs() };
  },
};

parentPort.on('message', ({ id, op, args }) => {
  try {
    parentPort.postMessage({ id, result: handlers[op](args) });
  } catch (e) {
    parentPort.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
});
