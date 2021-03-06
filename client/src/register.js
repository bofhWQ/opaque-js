const sodium = require('sodium-native')
const oprf = require('./oprf')

/**
 * Client-side registration flow
 *
 * 1. Send username to server
 * 2. Generate keypair
 * 3. Perform OPRF flow with password as input
 * 4. Encrypt keypair and server public key using OPRF output as key
 * 5. Send encrypted parameters and public key to server
 */

class RegistrationClient {
  start ({ username, password }) {
    // generate keypair
    const {
      crypto_kx_PUBLICKEYBYTES: pkLength,
      crypto_kx_SECRETKEYBYTES: skLength
    } = sodium
    const pk = Buffer.alloc(pkLength)
    const sk = sodium.sodium_malloc(skLength)
    sodium.crypto_kx_keypair(pk, sk)
    this.pk = pk
    this.sk = sk

    // put buffered password on class
    this.password = Buffer.from(password)

    // begin OPRF flow
    const { challenge, r } = oprf.challenge({ password: this.password })
    // we will need the random scalar and username later
    this.randomScalar = r
    this.username = username

    // challenge can now be consumed be the server
    return { username, challenge }
  }
  register ({ response, oprfPublicKey, serverPublicKey, hashOpsLimit, hashMemLimit, hashSalt }) {
    // server sent back response to challenge and OPRF public key
    // complete the OPRF flow
    const rwd = oprf.output({
      password: this.password,
      response,
      oprfPublicKey,
      r: this.randomScalar
    })

    // apply argon2 to rwd using the hardening params sent from the server
    const key = sodium.sodium_malloc(sodium.crypto_secretbox_KEYBYTES)
    sodium.crypto_pwhash(key, rwd, hashSalt, hashOpsLimit, hashMemLimit, sodium.crypto_pwhash_ALG_DEFAULT)

    // use rwd as the key to an authenticated encryption of
    // client's keypair and server's kx public key
    const nonce = Buffer.alloc(sodium.crypto_secretbox_NONCEBYTES)
    const message = Buffer.from(JSON.stringify({
      userPublicKey: this.pk,
      userSecretKey: this.sk,
      serverPublicKey
    }))
    const ciphertext = Buffer.alloc(message.length + sodium.crypto_secretbox_MACBYTES)

    sodium.randombytes_buf(nonce) // insert random data into nonce
    sodium.crypto_secretbox_easy(ciphertext, message, nonce, key)

    const envelope = { ciphertext, nonce }
    return { username: this.username, publicKey: this.pk, envelope }
  }
}

module.exports = RegistrationClient
