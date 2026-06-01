# Vendor Checkouts

`clawpatch/` is an ignored nested Git checkout of the customized Clawpatch fork:

```sh
git clone https://github.com/adam-jackson-cf/clawpatch.git vendor/clawpatch
git -C vendor/clawpatch remote add upstream https://github.com/openclaw/clawpatch.git
```

Keep Clawpatch source changes committed inside `vendor/clawpatch`. Keep workspace experiment assets committed in the parent repository.
