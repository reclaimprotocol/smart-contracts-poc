import Client from 'mina-signer'
import { Encoding, Experimental, Field, Provable, PublicKey, Signature } from 'o1js'

jest.setTimeout(300_000)

it('should sign off-chain and verify on-chain', async() => {
	const client = new Client({ network: 'mainnet' })
	const keys = client.genKeys()
	const message = '{"id":123123,"hnid":"sdgsdtgs","email":"berbebqb@qerbqerb.co","full_name":"qerbqerbn","avatar_thumb":"2e3e23e23e","admin":false,"can_view_batch_schedule":true}'

	//message needs to be converted to fields for signing
	const fields = Encoding.stringToFields(message)
	const sign = client.signFields(fields.map(f => f.toBigInt()), keys.privateKey)


	//these values will be used inside circuit
	const signature = Signature.fromBase58(sign.signature)
	const pub = PublicKey.fromBase58(keys.publicKey)
	const fieldsSnarky = fields.map(Field)

	//holder for message
	const Message = Provable.Array(Field, fields.length)
	const MyProgram = Experimental.ZkProgram({
		methods: {
			verifySignature: {
				privateInputs: [Signature, Message],
				method(signature: Signature, message: Field[]) {
					signature.verify(pub, message).assertTrue()
				},
			},
		},
	})

	console.log('compiling circuit')
	await MyProgram.compile()
	console.log('proving')
	const proof = await MyProgram.verifySignature(signature, fieldsSnarky)
	console.log('verifying proof')
	const ok = await MyProgram.verify(proof)
	expect(ok).toEqual(true)
})


