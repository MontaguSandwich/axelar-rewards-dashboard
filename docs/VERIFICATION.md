# Rewards Calculation Verification Guide

## Quick Verification Steps

### 1. Check Pool Parameters On-Chain

Use this LCD query to verify pool parameters for any chain:

```
https://axelar-lcd.imperator.co/cosmwasm/wasm/v1/contract/axelar1harq5xe68lzl2kx4e5ch4k8840cgqnry567g0fgw7vt2atcuugrqfa7j5z/smart/[BASE64_QUERY]
```

**Example: Query Flow voting pool**

Query JSON:
```json
{"rewards_pool":{"pool_id":{"chain_name":"flow","contract":"axelar1m4semgh98pk8dp3lgfv8ul47x7fwt0ynqapek9fy0szhmc36l3aqhz47vu"}}}
```

Base64: `eyJyZXdhcmRzX3Bvb2wiOnsicG9vbF9pZCI6eyJjaGFpbl9uYW1lIjoiZmxvdyIsImNvbnRyYWN0IjoiYXhlbGFyMW00c2VtZ2g5OHBrOGRwM2xnZnY4dWw0N3g3Znd0MHlucWFwZWs5Znkwc3pobWMzNmwzYXFoejQ3dnUifX19`

Full URL:
```
https://axelar-lcd.imperator.co/cosmwasm/wasm/v1/contract/axelar1harq5xe68lzl2kx4e5ch4k8840cgqnry567g0fgw7vt2atcuugrqfa7j5z/smart/eyJyZXdhcmRzX3Bvb2wiOnsicG9vbF9pZCI6eyJjaGFpbl9uYW1lIjoiZmxvdyIsImNvbnRyYWN0IjoiYXhlbGFyMW00c2VtZ2g5OHBrOGRwM2xnZnY4dWw0N3g3Znd0MHlucWFwZWs5Znkwc3pobWMzNmwzYXFoejQ3dnUifX19
```

### 2. Expected Response

```json
{
  "data": {
    "balance": "123456000000",
    "epoch_duration": "47250",
    "rewards_per_epoch": "3424660000",
    "current_epoch_num": "XXX",
    "last_distribution_epoch": "XXX",
    "params": {
      "rewards_per_epoch": "3424660000",
      "participation_threshold": ["8", "10"],
      "epoch_duration": "47250"
    }
  }
}
```

**Key values:**
- `rewards_per_epoch`: 3424660000 uaxl = **3,424.66 AXL**
- `epoch_duration`: 47250 blocks = **~24.15 hours** (at 1.84s/block)
- `participation_threshold`: 8/10 = **80%**

### 3. Calculate Expected Rewards

**Our Formula:**
```
rewards_per_verifier_per_epoch = rewards_per_epoch / active_verifiers
```

**Example with 29 verifiers:**
```
3,424.66 AXL / 29 = 118.09 AXL per epoch per verifier
```

**Weekly rewards (assuming ~6.95 epochs/week):**
```
118.09 * 6.95 = 820.73 AXL per week per verifier
```

### 4. Cross-Reference with Axelarscan

1. Visit: https://axelarscan.io/amplifier-rewards/flow
2. Note the "Verifying Rewards" and "Signing Rewards" values
3. These should show 3,424.66 AXL per epoch (total pool rewards)
4. Per-verifier rewards = total / verifier_count

### 5. Check Verifier Count

Query Service Registry for active verifiers:

```
https://axelar-lcd.imperator.co/cosmwasm/wasm/v1/contract/axelar1rpj2jjrv3vpugx9ake9kgk3s2kgwt0y60wtkmcgfml5m3et0mrls6nct9m/smart/[BASE64]
```

Query JSON for active verifiers on a chain:
```json
{"active_verifiers":{"service_name":"amplifier","chain_name":"flow"}}
```

### 6. Verify Block Time

Check recent blocks at: https://axelarscan.io/blocks

Calculate average time between consecutive blocks. Should be ~1.84 seconds.

## Contract Addresses Reference

| Contract | Address |
|----------|---------|
| Rewards | `axelar1harq5xe68lzl2kx4e5ch4k8840cgqnry567g0fgw7vt2atcuugrqfa7j5z` |
| Service Registry | `axelar1rpj2jjrv3vpugx9ake9kgk3s2kgwt0y60wtkmcgfml5m3et0mrls6nct9m` |
| Global Multisig | `axelar14a4ar5jh7ue4wg28jwsspf23r8k68j7g5d6d3fsttrhp42ajn4xq6zayy5` |

## Common Issues

### Signing pools show different rewards
- Signing pools use the **global Multisig contract** (per governance)
- NOT chain-specific MultisigProver contracts
- All chains share the same signing pool contract

### Verifier count mismatch
- Service Registry shows currently registered verifiers
- Some may not be actively participating
- Rewards only go to verifiers meeting 80% participation threshold

### Epoch timing
- Each epoch is 47,250 blocks (~24.15 hours)
- Rewards distribute at epoch boundaries
- `last_distribution_epoch` shows when rewards were last claimed
