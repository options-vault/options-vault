;; vault
;; Contract that holds all the logic for processing deposits and withdrawals, distributing pnl, creating a pnl settlement pool and claiming pnl,
;; as well as containing a ledger map that keeps track of all investor balances as well as a settlement pool that holds all funds owed to in-the-money NFT holders.

;; constants

(define-constant CONTRACT_ADDRESS (as-contract tx-sender))
(define-constant OPTIONS_NFT_CONTRACT .options-nft)

(define-constant ERR_INVALID_AMOUNT (err u100))
(define-constant ERR_VAULT_NOT_ALLOWED (err u101))
(define-constant ERR_INSUFFICIENT_FUNDS (err u102))
(define-constant ERR_TX_SENDER_NOT_IN_LEDGER (err u103))
(define-constant ERR_ONLY_NFT_CONTRACT_ALLOWED (err u104))
(define-constant ERR_TX_NOT_APPLIED_YET (err u105))
(define-constant ERR_SETTLEMENT_POOL_NOT_ENOUGH (err u106))
(define-constant ERR_INSUFFICIENT_CONTRACT_FUNDS (err u107))

;; data maps and vars

;; Ledger map to store balances and withdraw/deposit requests for each principal (investor type / vault)
(define-map ledger principal { address: principal, balance: uint, pending-deposits: uint, pending-withdrawal: uint })

(define-data-var investor-addresses (list 1000 principal) (list))
(define-data-var total-balances uint u0)
(define-data-var temp-total-balances uint u0)
(define-data-var total-pending-deposits uint u0)
(define-data-var total-settlement-pool uint u0)

;; private functions

;; Balance private helper functions
(define-private (subtract-from-balance (amount uint) (investor principal)) 
  (- (default-to u0 (get-investor-balance investor)) amount)
)

;; Deposit private helper functions
(define-private (add-pending-deposit (amount uint))
  (+ (get-pending-deposit) amount)
)

;; Withdrawal private helper functions
(define-private (add-pending-withdrawal (amount uint))
  (+ (get-pending-withdrawal) amount)
)

;; Update investor-addresses list, helper function
(define-private (add-to-list (investor principal))
  (var-set investor-addresses (unwrap-panic (as-max-len? (append (var-get investor-addresses) investor) u1000)))
)

;; <process-deposits-updater>: Adds the pending-deposit amount (and resets it) to balance amount for each investor in the ledger,
;;                             also adds this amount to total-balances
(define-private (process-deposits-updater (investor principal)) 
  (let  (
          (investor-info (unwrap-panic (map-get? ledger investor)))
          (investor-balance (get balance investor-info))
          (investor-pending-deposit (get pending-deposits investor-info))
        )
        (map-set ledger
          investor
          (merge 
            investor-info
            {
              balance: 
                (+ investor-balance investor-pending-deposit),
              pending-deposits:
                u0
            }
          )
        )
        (var-set total-balances (+ (var-get total-balances) investor-pending-deposit))
        (var-set total-pending-deposits (- (var-get total-pending-deposits) investor-pending-deposit))
  )
)

;; <process-withdrawals-updater>: Subtracts the pending-withdrawal amount (and resets it) from balance amount for each investor in the ledger
;;                                and make a transfer of the pending-withdrawal amount from the vaul contract to the investor's address, but 
;;                                only if there is some conditions true, also subtracts this amount from total-balances to keep this variable 
;;                                updated.
(define-private (process-withdrawals-updater (investor principal)) 
  (let  (
          (investor-info (unwrap-panic (map-get? ledger investor)))
          (investor-balance (get balance investor-info))
          (investor-pending-withdrawal (get pending-withdrawal investor-info))
          (investor-address (get address investor-info))
          (investor-withdrawal-allowed (if (> investor-pending-withdrawal investor-balance) investor-balance investor-pending-withdrawal))
        )
        (if (> investor-pending-withdrawal u0)
            ;; if investor's balance is equal or greater than the pending-withdrawal amount
            ;; and investor's pending-withdrawal amount is greater than 0
            (begin
              (try! (as-contract (stx-transfer? investor-withdrawal-allowed tx-sender investor-address)))
              (var-set total-balances (- (var-get total-balances) investor-withdrawal-allowed))
              (map-set ledger
                investor
                (merge
                  investor-info
                  {
                    balance: 
                      (subtract-from-balance investor-withdrawal-allowed investor),
                    pending-withdrawal:
                      u0
                  }  
                )
              )
              ;; if false, tranfers what is in the balance to the investor and delete the investor from the ledger and the investor's list
              (if 
                (is-eq (get balance (unwrap-panic (map-get? ledger investor))) u0)
                (map-delete ledger investor)
                true
              )
            )
            true
        )
        (ok true)
  )
)

;; <investors-filter>: Filters out investors from the investor-addresses list that no longer have a balance.
(define-private (investors-filter (investor principal)) 
  (is-some (map-get? ledger investor))
)

;;<pnl-evaluator>: Calculates the pnl for each investor's participation in the vault, updates its balance and updates the total-balances
;;                 that summarize all the investor's balances in the ledger 
(define-private (pnl-evaluator (investor principal)) 
  (let  (
          (total-balance (var-get total-balances))
          (temp-total-balance (var-get temp-total-balances))
          (vault-balance (- (- (stx-get-balance CONTRACT_ADDRESS) (var-get total-pending-deposits)) (var-get total-settlement-pool))) 
          (investor-info (unwrap-panic (map-get? ledger investor)))
          (investor-balance (get balance investor-info))
          (investor-new-balance (/ (* investor-balance vault-balance) temp-total-balance))
        )
        (map-set ledger
          investor
          (merge 
            investor-info
            {
              balance: 
                investor-new-balance
            }
          )
        )
        (var-set total-balances (+ (- total-balance investor-balance) investor-new-balance))
  )
)

;; public functions

;; <process-deposits>: The function iterates over the `investor-addresses` list and applies the `pending-deposits` amount to 
;;                     the investor's ledger `balance`.
(define-public (process-deposits)
  (begin
    (asserts! (is-eq tx-sender OPTIONS_NFT_CONTRACT) ERR_ONLY_NFT_CONTRACT_ALLOWED)
    (map process-deposits-updater (var-get investor-addresses))
    (ok true)
  )
)

;; <deposit-premium>: The function transfers the STX amount paid by user 2 for minting an options NFT (the premium) to the vault contract.
(define-public (deposit-premium (amount uint) (original-sender principal)) 
  (begin
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)
    (asserts! (not (is-eq original-sender CONTRACT_ADDRESS)) ERR_VAULT_NOT_ALLOWED)
    (try! (stx-transfer? amount original-sender CONTRACT_ADDRESS))
    (ok true)
  )
)

;; <queue-deposit>: The function transfers the deposited STX amount to the vault contract and adds the amount to the `pending-deposits`
;;                  property of the investor's entry in the vault `ledger`. If it is the first deposit for the investor, the function
;;                  adds the investor's address (principal) to the`investor-addresses` list.
(define-public (queue-deposit (amount uint)) 
  (begin
    (asserts! (not (is-eq tx-sender CONTRACT_ADDRESS)) ERR_VAULT_NOT_ALLOWED)
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)
    (try! (stx-transfer? amount tx-sender CONTRACT_ADDRESS))
    (if (map-insert ledger 
          tx-sender
          {
            address: tx-sender,
            balance: u0,
            pending-deposits: amount,
            pending-withdrawal: u0
          }
        )
      (add-to-list tx-sender)
      (map-set ledger  
        tx-sender
        (merge 
          (unwrap-panic (map-get? ledger tx-sender))
          {
            pending-deposits:
              (add-pending-deposit amount) 
          }
        )
      )
    )
    (var-set total-pending-deposits (+ (var-get total-pending-deposits) amount))
    (ok true)     
  )
)

;; <process-withdrawals>: The function iterates over the `investor-addresses` list and applies the `pending-withdrawal` amount to the investor's
;;                        ledger `balance`. If the investor has the necessary balance available the function processes the withdrawal by sending
;;                        an on-chain STX transfer for the requested amount.
(define-public (process-withdrawals)
  (begin
    (asserts! (is-eq tx-sender OPTIONS_NFT_CONTRACT) ERR_ONLY_NFT_CONTRACT_ALLOWED)
    (map process-withdrawals-updater (var-get investor-addresses))
    (var-set investor-addresses (filter investors-filter (var-get investor-addresses)))
    (ok true)
  )
)

;; <queue-withdrawal>: The function adds the requested withdrawal amount to the pending-withdrawal property of the investor's entry in the vault ledger. 
;;                     The function does not send an on-chain transaction but only queues the withdrawal to be processed at the end of the cycle with process-withdrawal.
(define-public (queue-withdrawal (amount uint)) 
  (let  (
          (investor-balance (unwrap! (get-investor-balance tx-sender) ERR_TX_SENDER_NOT_IN_LEDGER))
          (investor-pending-withdrawal (get-pending-withdrawal))
          (investor-info (unwrap-panic (map-get? ledger tx-sender)))
        )
        (asserts! (>= investor-balance (+ investor-pending-withdrawal amount)) ERR_INSUFFICIENT_FUNDS)
        (map-set ledger  
          tx-sender
          (merge 
            investor-info
            {
              pending-withdrawal:
                (add-pending-withdrawal amount) 
            }
          )
        )
        (ok true)
  )
)

;;<distribute-pnl>: The function distributes the cycle's profit and loss (pnl) to the investor's in the ledger on a pro-rata basis.
(define-public (distribute-pnl)
  (begin
    (asserts! (is-eq tx-sender OPTIONS_NFT_CONTRACT) ERR_ONLY_NFT_CONTRACT_ALLOWED)
    (var-set temp-total-balances (var-get total-balances))
    (map pnl-evaluator (var-get investor-addresses))
    ;; TODO: Investigate reason for the assert not to work for ITM scenarios, because of a rounding error?
    ;; (asserts! (is-eq 
    ;;   (var-get total-balances) 
    ;;   (- (- (stx-get-balance CONTRACT_ADDRESS) (var-get total-pending-deposits)) (var-get total-settlement-pool))) ERR_PREMIUM_NOT_SPLITTED_CORRECTLY)
    (ok true)
  )
)

;; <create-settlement-pool>: The function allows options-nft contract to ask vault contract to reserve the STX amount owed to the
;;                           cycle's NFT holders, creating a settlement-pool. It is called by the options-nft contract as part of the logic
;;                           for determine-value-and-settle and only executes in case of an in-the-money options NFT.
;; #[allow(unchecked_data)]
(define-public (create-settlement-pool (amount uint))
  (begin
    (asserts! (is-eq tx-sender OPTIONS_NFT_CONTRACT) ERR_ONLY_NFT_CONTRACT_ALLOWED)
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)
    (var-set total-settlement-pool (+ (var-get total-settlement-pool) amount))
    (ok true)
  )
)

;; <claim-settlement>: Allows the options-nft contract to ask for a tx that transfers pnl (if there is some), from the vault to the user 2 type
;; #[allow(unchecked_data)]
(define-public (claim-settlement (amount uint) (recipient principal)) 
  (begin
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)
    (asserts! (is-eq tx-sender OPTIONS_NFT_CONTRACT) ERR_ONLY_NFT_CONTRACT_ALLOWED)
    (asserts! (>= (var-get total-settlement-pool) amount) ERR_SETTLEMENT_POOL_NOT_ENOUGH)
    (asserts! (>= (stx-get-balance CONTRACT_ADDRESS) amount) ERR_INSUFFICIENT_CONTRACT_FUNDS)
    (try! (as-contract (stx-transfer? amount tx-sender recipient)))
    (var-set total-settlement-pool (- (var-get total-settlement-pool) amount))
    (ok true)
  )
)

;; Balance public helper function
(define-read-only (get-investor-balance (investor principal))
  (get balance (map-get? ledger investor))
)

;; Deposit public helper function
(define-read-only (get-pending-deposit) 
  (default-to u0 (get pending-deposits (map-get? ledger tx-sender)))
)

;; Withdrawal public helper function
(define-read-only (get-pending-withdrawal) 
  (default-to u0 (get pending-withdrawal (map-get? ledger tx-sender)))
)

;; Get total balances public helper function
(define-read-only (get-total-balances) 
  (var-get total-balances)
)

;; TESTING HELPER FUNCTIONS
;; (!) For testing purposes only, not to be deployed to production (!)
;; (!) Delete these functions for deployment to improve contract security and cost efficiency (!)

(define-read-only (get-total-settlement-pool) 
  (var-get total-settlement-pool)
)