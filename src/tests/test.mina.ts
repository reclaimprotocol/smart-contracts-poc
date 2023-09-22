import Client from 'mina-signer'
import {
	AccountUpdate,
	Encoding,
	Experimental,
	Field,
	method,
	Mina,
	PrivateKey,
	Provable,
	PublicKey,
	Signature,
	SmartContract,
	State,
	state,
	Struct
} from 'o1js'

jest.setTimeout(300_000)

const message = '{"id":123123,"hnid":"sdgsdtgs","email":"berbebqb@qerbqerb.co","full_name":"qerbqerbn","avatar_thumb":"2e3e23e23e","admin":false,"can_view_batch_schedule":true}'
const messageFields = Encoding.stringToFields(message)

it('should sign off-chain and verify on-chain', async() => {
	const client = new Client({ network: 'mainnet' })
	const keys = client.genKeys()


	//message needs to be converted to fields for signing

	const sign = client.signFields(messageFields.map(f => f.toBigInt()), keys.privateKey)


	//these values will be used inside circuit
	const signature = Signature.fromBase58(sign.signature)
	const pub = PublicKey.fromBase58(keys.publicKey)
	const fieldsSnarky = messageFields.map(Field)

	//holder for message
	const Message = Provable.Array(Field, messageFields.length)
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

it('should work in smart contract', async() => {

	//init blockchain
	const Local = Mina.LocalBlockchain({ proofsEnabled: true })
	Mina.setActiveInstance(Local)

	const witnessKey = PrivateKey.random()
	const contractKey = PrivateKey.random()
	const feePayer = Local.testAccounts[0].privateKey

	const contractAddress = contractKey.toPublicKey()

	class Msg extends Struct({
		value: Provable.Array(Field, messageFields.length) //TODO: figure out if arbitrary length arrays are possible
	}) {
	}

	class Reclaim extends SmartContract {
        // a commitment is a cryptographic primitive that allows us to commit to data, with the ability to "reveal" it later
        @state(PublicKey) witness = State<PublicKey>()

        @method init() {
        	super.init()
        	this.witness.set(witnessKey.toPublicKey())
        }

        @method checkSignature(signature: Signature, message: Msg) {
        	const witness = this.witness.get()
        	this.witness.assertEquals(witness)
        	signature.verify(witness, message.value).assertTrue()
        }
	}

	//compile app
	console.log('compiling smart contract')
	const reclaimApp = new Reclaim(contractKey.toPublicKey())
	await Reclaim.compile()


	//deploy contract
	console.log('deploying contract...')
	let txn = await Mina.transaction(feePayer.toPublicKey(), () => {
		AccountUpdate.fundNewAccount(feePayer.toPublicKey())
		reclaimApp.deploy()
	})
	await txn.prove()
	await txn.sign([feePayer, contractKey]).send()


	const initialState =
        Mina.getAccount(contractAddress).zkapp?.appState?.[0].toString()
	console.log('Initial State', initialState)


	//sign message with witness key

	const client = new Client({ network: 'mainnet' })
	const sign = client.signFields(messageFields.map(f => f.toBigInt()), witnessKey.toBase58())

	console.log('checking signature on chain')
	txn = await Mina.transaction(feePayer.toPublicKey(), () => {
		reclaimApp.checkSignature(Signature.fromBase58(sign.signature), { value: messageFields })
	})
	await txn.prove()
	await txn.sign([feePayer]).send()

	console.log('checking bad signature on chain')
	const badSign = client.signFields(Encoding.stringToFields('Hello').map(f => f.toBigInt()), witnessKey.toBase58())

	await expect(Mina.transaction(feePayer.toPublicKey(), () => {
		reclaimApp.checkSignature(Signature.fromBase58(badSign.signature), { value: messageFields })
	})).rejects.toThrow('Bool.assertTrue(): false != true')


})


