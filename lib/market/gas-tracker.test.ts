import assert from "node:assert/strict"
import test from "node:test"
import { parseGasTracker, rowsFromTrackerPayload } from "./gas-tracker"

const HTML = `
<div id="gasguzzler" role="tabpanel">
  <span>Last updated at Block <a href='/block/26240087'>26240087</a></span>
  <table>
    <tr><td>1</td><td><a href='/address/0xdAC17F958D2ee523a2206206994597C13D831ec7' data-full-address='0xdAC17F958D2ee523a2206206994597C13D831ec7'>Tether: USDT Stablecoin</a><a data-clipboard-text='0xdAC17F958D2ee523a2206206994597C13D831ec7'></a></td><td data-bs-order='4026.36'>$4,026.36 <span>(1.64 Eth)</span></td><td><span title='Gas Units Used : 2,060,067,938'>7.52%</span></td><td>$40,874.88 <span>(16.61 Eth)</span></td><td><span title='Gas Units Used : 16,119,762,519'>7.40%</span></td></tr>
    <tr><td>2</td><td><a href='/address/0x0dE8bf93dA2f7eecb3d9169422413A9bef4ef628' data-clipboard-text='0x0dE8bf93dA2f7eecb3d9169422413A9bef4ef628'>CoinTool: XEN Batch Minter</a></td><td>$165.39 <span>(0.07 Eth)</span></td><td><span title='Gas Units Used : 1'>0.98%</span></td><td>$1,384.63 <span>(0.55 Eth)</span></td><td>0.34%</td></tr>
  </table>
</div>
<div id="gasspender" role="tabpanel">
  <table>
    <tr><td>1</td><td><a href='/address/0x1111111111111111111111111111111111111111' data-clipboard-text='0x1111111111111111111111111111111111111111'>0x111111...111111</a></td><td>$10.00 <span>(0.01 Eth)</span></td><td>13.11%</td><td>$20.00 <span>(0.02 Eth)</span></td><td>2.79%</td></tr>
  </table>
</div>
<div id="historicaldata"></div>
`

test("the gas tracker data feed keeps the name and the address that Copy uses", () => {
  const rows = rowsFromTrackerPayload({
    data: [{
      address: "<a href='/address/0xdAC17F958D2ee523a2206206994597C13D831ec7' data-clipboard-text='0xdAC17F958D2ee523a2206206994597C13D831ec7'>Tether: USDT Stablecoin</a>",
      txfee_3h: "$4,026.36 <span>(1.64 Eth)</span>",
      gasused_3h: "<span title='Gas Units Used : 2,060,067,938'>7.52%</span>",
      txfee_24h: "$40,874.88 <span>(16.61 Eth)</span>",
      gasused_24h: "7.40%",
    }],
  })
  assert.equal(rows[0].name, "Tether: USDT Stablecoin")
  assert.equal(rows[0].address, "0xdAC17F958D2ee523a2206206994597C13D831ec7")
  assert.equal(rows[0].fee3Usd, "$4,026.36")
  assert.equal(rows[0].share3Text, "7.52%")
  assert.equal(rows[0].gas3, "2,060,067,938")
})

test("the gas tracker page keeps Etherscan's name, address, fees, and percentages", () => {
  const board = parseGasTracker(HTML)
  assert.equal(board.block, 26240087)
  assert.equal(board.guzzlers.length, 2)
  assert.equal(board.guzzlers[0].name, "Tether: USDT Stablecoin")
  assert.equal(board.guzzlers[0].address, "0xdAC17F958D2ee523a2206206994597C13D831ec7")
  assert.equal(board.guzzlers[0].fee3Usd, "$4,026.36")
  assert.equal(board.guzzlers[0].fee3Eth, "1.64 Eth")
  assert.equal(board.guzzlers[0].share3Text, "7.52%")
  assert.equal(board.guzzlers[0].gas3, "2,060,067,938")
  assert.equal(board.guzzlers[0].fee24Usd, "$40,874.88")
  assert.equal(board.guzzlers[0].share24, 7.4)
  assert.equal(board.guzzlers[1].name, "CoinTool: XEN Batch Minter")
  assert.equal(board.spenders[0].address, "0x1111111111111111111111111111111111111111")
  assert.equal(board.spenders[0].name, "0x111111...111111")
  assert.equal(board.spenders[0].share3Text, "13.11%")
})
