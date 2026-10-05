# Golf cart source

`golf-cart.ts` is the packaged copy of the game's `src/golf-cart.ts` builder. It
authors the two-seat resort cart, spinning wheel groups and seated driver in
metres with Y up and local +Z forward. `DriverPolo` is the recolorable shirt.

The builder merges surfaces by material and keeps wheels shared between carts.
`disposeGolfCart(model)` releases only one cart's owned resources; shared wheel
buffers and immutable surface materials remain available to other visitors.

To regenerate the binary model from the main project, use Node 22 or newer:

```sh
node --experimental-strip-types assets/tools/export-golf-cart.mjs
```

For a standalone asset-kit copy, install the same existing engine dependency at
the asset-kit root, then run the packaged exporter:

```sh
npm install --no-save three@0.186.1
node --experimental-strip-types tools/export-golf-cart.mjs
```

After editing the game's builder, update this packaged source copy before
regenerating the GLB. Golf cart wheels and driver visibility animate in the
runtime; the standalone GLB contains their named transform groups without baked
animation clips.
