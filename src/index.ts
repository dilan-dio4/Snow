import dotenv from 'dotenv';
dotenv.config();
import fastify from 'fastify'
import currencies, { AvailableTickers, AvailableWallets } from "./currencies";
import AdminDash from "./adminWallets/Dash";
import AdminLitecoin from "./adminWallets/Litecoin";
import AdminSolana from "./adminWallets/Solana";
import TransactionalSolana from "./transactionalWallets/Solana";
import auth from './middlewares/auth';
import mongoGenerator from "./mongoGenerator";

const server = fastify({ trustProxy: true });

const activeTransactions: Record<string, TransactionalSolana> = {};

let adminDashClient: AdminDash;
let adminLtcClient: AdminLitecoin;
let adminSolClient: AdminSolana;

for (const k of Object.keys(currencies)) {
    const ticker = k as AvailableTickers;
    const coinName = currencies[ticker].name;
    const publicKey = process.env[`ADMIN_${ticker.toUpperCase()}_PUBLIC_KEY`];
    const privateKey = process.env[`ADMIN_${ticker.toUpperCase()}_PRIVATE_KEY`];

    if (!publicKey || !privateKey) {
        continue;
    }

    const params = [publicKey, privateKey] as const;
    let currentClient: AvailableWallets;
    if (ticker === "dash") {
        adminDashClient = new AdminDash(...params);
        currentClient = adminDashClient;
    } else if (ticker === "ltc") {
        adminLtcClient = new AdminLitecoin(...params);
        currentClient = adminLtcClient;
    } else if (ticker === "sol") {
        adminSolClient = new AdminSolana(...params);
        currentClient = adminSolClient;
    }

    server.get(`/get${coinName}Balance`, { preHandler: auth }, (request, reply) => currentClient.getBalance());

    server.post<{ Body: Record<string, any> }>(`/send${coinName}Transaction`, { preHandler: auth }, (request, reply) => currentClient.sendTransaction(request.body.destination, request.body.amount));
}

function transactionIntervalRunner() {
    setInterval(() => {
        Object.values(activeTransactions).forEach(ele => ele.checkTransaction());
    }, +process.env.TRANSACTION_REFRESH_TIME)
}

async function init() {
    const { db } = await mongoGenerator();
    const _activeTransactions = await db.collection('transactions').find({ status: "WAITING" }).toArray();
    for (const _currActiveTransaction of _activeTransactions) {
        switch (_currActiveTransaction.currency as AvailableTickers) {
            case "sol":
                activeTransactions[_currActiveTransaction._id.toString()] = new TransactionalSolana(id => delete activeTransactions[id]).fromManual({
                    ..._currActiveTransaction as any,
                    id: _currActiveTransaction._id.toString()
                })
                break;
            default:
                break;
        }
    }
    transactionIntervalRunner();
    server.listen({ port: 8081 }, (err, address) => {
        if (err) {
            console.error(err)
            process.exit(1)
        }
        console.log(`Server listening at ${address}`)
    });
}

init();
