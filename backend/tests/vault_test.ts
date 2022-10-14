
import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v1.0.2/index.ts';
import { assert, assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';
import { CreateTwoDepositorsAndProcess } from "./deps.ts"



Clarinet.test({
    name: "Ensure that users can deposit and their funds are processed",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet_1 = accounts.get('wallet_1')?.address ?? ""
        const wallet_2 = accounts.get('wallet_2')?.address ?? ""
        let block = CreateTwoDepositorsAndProcess(chain, accounts)


        block.receipts[0].events.expectSTXTransferEvent(1000, wallet_1, "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.vault")
        block.receipts[1].events.expectSTXTransferEvent(2000, wallet_2, "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.vault")
        block.receipts[2].result.expectOk()
        //console.log(block.receipts[0].events[0])
    },
});
