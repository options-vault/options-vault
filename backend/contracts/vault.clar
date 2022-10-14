
;; vault
;; Balance holder that has withdraw/deposit functions, and ledger storage

;; constants
;;
(define-constant CONTRACT_ADDRESS (as-contract tx-sender))

(define-constant INVALID_AMOUNT (err u100))
(define-constant VAULT_NOT_ALLOWED (err u101))
(define-constant INSUFFICIENT_FUNDS (err u102))
(define-constant TX_SENDER_NOT_IN_LEDGER (err u103))
(define-constant ONLY_CONTRACT_ALLOWED (err u104))
(define-constant HAS_TO_WAIT_UNTIL_NEXT_BLOCK (err u105))
(define-constant TX_NOT_APPLIED_YET (err u106))

;; data maps and vars

;; Ledger map to store balances and withdraw/deposit requests for each principal (investor type / vault)
(define-map ledger principal { address: principal, balance: uint, pending-deposits: uint, pending-withdraw: uint })

(define-data-var investor-addresses (list 1000 principal) (list))

(define-data-var total-balances uint u0)
(define-data-var temp-total-balances uint u0)

(define-data-var total-pending-deposits uint u0)

(define-data-var block-height-settlement uint u0)

;; private functions

;; Functions that checks what is the user's balance/pending-withdraw/pending-deposit in the vault

;; Balance helper functions
(define-read-only (get-balance)
  (get balance (map-get? ledger tx-sender))
)

(define-private (add-to-balance (amount uint)) 
  (+ (default-to u0 (get-balance)) amount)
)

(define-private (substract-to-balance (amount uint)) 
  (- (default-to u0 (get-balance)) amount)
)

;; Deposit helper functions
(define-read-only (get-pending-deposit) 
  (default-to u0 (get pending-deposits (map-get? ledger tx-sender)))
)

(define-private (add-pending-deposit (amount uint))
  (+ (get-pending-deposit) amount)
)

(define-private (substract-pending-deposit (amount uint)) 
  (- (get-pending-deposit) amount)
)

;; Withdraw helper functions
(define-read-only (get-pending-withdraw) 
  (default-to u0 (get pending-withdraw (map-get? ledger tx-sender)))
)

(define-private (substract-pending-withdraw (amount uint)) 
  (-  (get-pending-withdraw) amount)
)

(define-private (add-pending-withdraw (amount uint))
  (+ (get-pending-withdraw) amount)
)

;; Update investor-addresses list - helper function
(define-private (add-to-list (investor principal))
  (var-set investor-addresses (unwrap-panic (as-max-len? (append (var-get investor-addresses) investor) u1000)))
)

;; public functions

;; DEPOSITS FUNCTIONS

;; <process-deposits>: Traverses investor-addresses list applying process-deposits-updater function to update the balance of each investor
(define-public (process-deposits)
  (begin
    (map process-deposits-updater (var-get investor-addresses))
    (ok true)
  )
)
;; <process-deposits-updater>: Adds the pending-deposit amount (and resets it) to balance amount for each investor in the ledger
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
  )
)

;; <deposit-premium>: Transfers the premium that comes from an user2 type when buys an option NFT
(define-public (deposit-premium (amount uint) (original-sender principal)) 
  (begin
    (asserts! (> amount u0) INVALID_AMOUNT)
    (asserts! (not (is-eq original-sender CONTRACT_ADDRESS)) VAULT_NOT_ALLOWED)
    (try! (stx-transfer? amount original-sender CONTRACT_ADDRESS))
    (ok true)
  )
)

;; <queue-deposit>: Transfers a deposit amount from an investor user to the vault contract and adds this amount to pending-deposit
;; property under the investor address key found in the ledger, if it is a new investor, the function creates a new investor in the ledger
;; Also adds the investor address in investor-address list, if it is a new one, and increments total-pending-deposits by the amount deposited
(define-public (queue-deposit (amount uint)) 
  (begin
    (asserts! (not (is-eq tx-sender CONTRACT_ADDRESS)) VAULT_NOT_ALLOWED)
    (asserts! (> amount u0) INVALID_AMOUNT)
    (try! (stx-transfer? amount tx-sender CONTRACT_ADDRESS))
    (if (map-insert ledger 
          tx-sender
          {
            address: tx-sender,
            balance: u0,
            pending-deposits: amount,
            pending-withdraw: u0
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

;; WITHDRAWAL FUNCTIONS

;; <process-withdrawals>: 
;; (define-public (process-withdrawals)
;;   (let  (
;;           (balance (unwrap! (get-balance) TX_SENDER_NOT_IN_LEDGER))
;;           (pending-withdraw (get-pending-withdraw))
;;           (sender-info (unwrap-panic (map-get? ledger tx-sender)))
;;         )
;;         (asserts! (>= balance pending-withdraw) INSUFFICIENT_FUNDS)
;;         (asserts! (> pending-withdraw u0) INVALID_AMOUNT)
;;         (try! (as-contract (stx-transfer? pending-withdraw tx-sender (get address sender-info))))
;;         (var-set total-balances (- (var-get total-balances) pending-withdraw))
;;         (map-set ledger
;;           tx-sender
;;           (merge
;;             sender-info
;;             {
;;               balance: 
;;                 (substract-to-balance pending-withdraw),
;;               pending-withdraw:
;;                 (substract-pending-withdraw pending-withdraw)
;;             }  
;;           )
;;         )
;;         (ok true)
;;   )
;; )

;; <process-withdrawals>: Traverses investor-addresses list applying process-withdrawals-updater function to execute the withdrawal
;; requested by each investor.
(define-public (process-withdrawals)
  (begin
    (map process-deposits-updater (var-get investor-addresses))
    (ok true)
  )
)

;; <process-deposits-updater>: Adds the pending-deposit amount (and resets it) to balance amount for each investor in the ledger
;; and make a transfer of the pending-withdraw amount from the vaul contract to the investor's address
(define-private (process-withdrawals-updater (investor principal)) 
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
  )
)

(define-public (queue-withdraw (amount uint)) 
  (let  (
          (balance (unwrap! (get-balance) TX_SENDER_NOT_IN_LEDGER))
          (pending-withdraw (get-pending-withdraw))
          (sender-info (unwrap-panic (map-get? ledger tx-sender)))
        )
        (asserts! (>= balance (+ pending-withdraw amount)) INSUFFICIENT_FUNDS)
        (map-set ledger  
          tx-sender
          (merge 
            sender-info
            {
              pending-withdraw:
                (add-pending-withdraw amount) 
            }
          )
        )
        (ok true)
  )
)

;; Distribute the premium between all the investor in the vault (depending of their participation rate)
;; TODO: Update total-balances in line with the updates to the individual investor's balance
;; TODO: Implement check that after distributor has run total-balances = vault-balance
(define-private (evaluator (investor principal)) 
  (let  (
          (total-balance (var-get total-balances))
          (vault-balance (stx-get-balance CONTRACT_ADDRESS)) ;; - pending_deposits 
          (investor-info (unwrap-panic (map-get? ledger investor)))
          (investor-balance (get balance investor-info))
        )
        (map-set ledger
          investor
          (merge 
            investor-info
            {
              balance: 
                (/ (* investor-balance vault-balance) total-balance)
            }
          )
        )
  )
)

(define-public (distribute-pnl)
  (begin
    ;; (asserts! (is-eq CONTRACT_ADDRESS tx-sender) ONLY_CONTRACT_ALLOWED)
    (asserts! (> (var-get block-height-settlement) block-height) HAS_TO_WAIT_UNTIL_NEXT_BLOCK)
    ;; assert that balance at block-height-settlement is not equal to balance block-height (now)
    ;; to handle edge cas where the settlement transaction was broadcast but was not mined in the first block
    (asserts! 
      (not (is-eq 
        (stx-get-balance CONTRACT_ADDRESS)
        (at-block (unwrap-panic (get-block-info? id-header-hash (var-get block-height-settlement))) (stx-get-balance CONTRACT_ADDRESS))
      ))
      TX_NOT_APPLIED_YET
    )
    (map evaluator (var-get investor-addresses))
    (ok true)
  )
)

;; Consult the total investor balances
(define-read-only (get-total-balances) 
  (var-get total-balances)
)

(define-read-only (get-investors-list) 
  (var-get investor-addresses)
)

;; TX to settlement contract what is owed to users2 type
;; #[allow(unchecked_data)]
(define-public (create-settlement-pool (amount uint) (settlement-contract principal))
  (begin
    (asserts! (> amount u0) INVALID_AMOUNT)
    (var-set block-height-settlement block-height)
    (try! (as-contract (stx-transfer? amount tx-sender settlement-contract)))
    (ok true)
  )
)