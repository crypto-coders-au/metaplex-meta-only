import * as anchor from '@project-serum/anchor';
import FormData from 'form-data';
import path from 'path';
import log from 'loglevel';
import fetch from 'node-fetch';
import { calculate } from '@metaplex/arweave-cost';
import { ARWEAVE_PAYMENT_WALLET } from '../constants';
import { sendTransactionWithRetryWithKeypair } from '../transactions';

const ARWEAVE_UPLOAD_ENDPOINT =
  'https://us-central1-metaplex-studios.cloudfunctions.net/uploadFile';

async function fetchAssetCostToStore(fileSizes: number[]) {
  const result = await calculate(fileSizes);
  log.debug('Arweave cost estimates:', result);

  return result.solana * anchor.web3.LAMPORTS_PER_SOL;
}

async function upload(data: FormData, manifest, index) {
  log.debug(`trying to upload ${index}.png: ${manifest.name}`);
  return await (
    await fetch(ARWEAVE_UPLOAD_ENDPOINT, {
      method: 'POST',
      // @ts-ignore
      body: data,
    })
  ).json();
}

function estimateManifestSize(filenames: string[]) {
  const paths = {};

  for (const name of filenames) {
    paths[name] = {
      id: 'artestaC_testsEaEmAGFtestEGtestmMGmgMGAV438',
      ext: path.extname(name).replace('.', ''),
    };
  }

  const manifest = {
    manifest: 'arweave/paths',
    version: '0.1.0',
    paths,
    index: {
      path: 'metadata.json',
    },
  };

  const data = Buffer.from(JSON.stringify(manifest), 'utf8');
  log.debug('Estimated manifest size:', data.length);
  return data.length;
}

export async function arweaveUploadMeta(
  walletKeyPair,
  anchorProgram,
  env,
  manifestBuffer, // TODO rename metadataBuffer
  manifest, // TODO rename metadata
  index,
) {
  const estimatedManifestSize = estimateManifestSize(['metadata.json']);
  const storageCost = await fetchAssetCostToStore([
    manifestBuffer.length,
    estimatedManifestSize,
  ]);
  console.log(`lamport cost to store ${manifest}: ${storageCost}`);

  const instructions = [
    anchor.web3.SystemProgram.transfer({
      fromPubkey: walletKeyPair.publicKey,
      toPubkey: ARWEAVE_PAYMENT_WALLET,
      lamports: storageCost,
    }),
  ];

  const tx = await sendTransactionWithRetryWithKeypair(
    anchorProgram.provider.connection,
    walletKeyPair,
    instructions,
    [],
    'confirmed',
  );
  log.debug(`solana transaction (${env}) for arweave payment:`, tx);

  const data = new FormData();
  data.append('transaction', tx['txid']);
  data.append('env', env);
  // data.append('file[]', fs.createReadStream(image), {
  //   filename: `image.png`,
  //   contentType: 'image/png',
  // });
  data.append('file[]', manifestBuffer, 'metadata.json');

  const result = await upload(data, manifest, index);

  const metadataFile = result.messages?.find(
    m => m.filename === 'manifest.json',
  );

  if (metadataFile?.transactionId) {
    const link = `https://arweave.net/${metadataFile.transactionId}`;
    log.debug(`File uploaded: ${link}`);
    return link;
  } else {
    // @todo improve
    throw new Error(`No transaction ID for upload: ${index}`);
  }
}
