import type { SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers";
import { takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import type { 
    Marketplace,
    ERC20Mock,
    ERC721Mock,
    OracleMock,
    Treasury
} from "../typechain-types";
import { makeChangeProxyAdmin } from "@openzeppelin/hardhat-upgrades/dist/admin";


describe("Marketplace", function () {
    let snapshotA: SnapshotRestorer

    // Signers.
    let deployer: SignerWithAddress
    let users: SignerWithAddress[]

    let marketplace: Marketplace
    let erc20: ERC20Mock
    let erc721: ERC721Mock
    let oracle: OracleMock
    let oracleEther: OracleMock
    let treasury: Treasury

    const USD_DECIMALS = 1e8
    const ERC20_DECIMALS = ethers.utils.parseEther("1")
    const MARKETPLACE_FEE = 10
    const ETHER_PRICE_USD = 2000e8 // 2000 USD

    // const erc20Rate = ethers.utils.parseEther('10') // 10 tokens for 1 usd

    before(async () => {
        // Getting of signers.
        let signers = await ethers.getSigners()
        deployer = signers[0]
        users = signers.slice(10, 20)

        const Treasury = await ethers.getContractFactory("Treasury", deployer)
        treasury = await Treasury.deploy()
        await treasury.deployed()
        
        const ERC20Mock = await ethers.getContractFactory("ERC20Mock", deployer)
        erc20 = await ERC20Mock.deploy()
        await erc20.deployed()

        const OracleMock = await ethers.getContractFactory("OracleMock", deployer)
        oracle = await OracleMock.deploy()
        await oracle.deployed()

        oracleEther = await OracleMock.deploy()
        await oracleEther.deployed()
        await oracleEther.setPrice(ETHER_PRICE_USD)
        
        const ERC721Mock = await ethers.getContractFactory("ERC721Mock", deployer)
        erc721 = await ERC721Mock.deploy()
        await erc721.deployed()

        const MarketPlace = await ethers.getContractFactory("Marketplace", deployer)
        marketplace = await upgrades.deployProxy(MarketPlace, []) as Marketplace
        await marketplace.deployed()
        await marketplace.setTreasury(treasury.address)
        await marketplace.setPaymentToken(erc20.address, oracle.address, true)
        await marketplace.setPaymentToken(oracleEther.address, oracleEther.address, true)

        snapshotA = await takeSnapshot()
    });

    afterEach(async () => await snapshotA.restore())

    describe("", function () {
        it("user can list nft on the marketplace", async () => {
            const NFT_ID = 1
            const NFT_PRICE = 1e8 // 1 usd with decimal 8
            await erc721.mint(users[0].address, NFT_ID)
            await erc721.connect(users[0]).approve(marketplace.address, NFT_ID)

            const SALE_DEAD_LINE = (await ethers.provider.getBlock("latest")).timestamp + 24*3600
            
            expect(await marketplace.connect(users[0]).listNft(erc721.address, NFT_ID, NFT_PRICE, SALE_DEAD_LINE))
                .to.emit(marketplace, "NftIsListed")
                .withArgs(users[0].address, erc721.address, NFT_ID, NFT_PRICE) 

            expect(await erc721.ownerOf(NFT_ID)).to.be.eq(marketplace.address)
        });
        it("user can buy nft from the marketplace", async () => {
            const NFT_ID = 1
            // const NFT_PRICE = 1e8 // 1 usd with decimal 8
            const NFT_PRICE = ethers.BigNumber.from(100e8); // 100 USDT
            await erc721.mint(users[0].address, NFT_ID)
            await erc721.connect(users[0]).approve(marketplace.address, NFT_ID)

            const SALE_DEAD_LINE = (await ethers.provider.getBlock("latest")).timestamp + 24*3600
            await marketplace.connect(users[0]).listNft(erc721.address, NFT_ID, NFT_PRICE, SALE_DEAD_LINE)

            const ERC20_RATE = await marketplace.getTokenPrice(erc20.address)
            const AMOUNT_ERC20 = NFT_PRICE.mul(ERC20_DECIMALS).div(ERC20_RATE)
            
            await erc20.mint(users[1].address, AMOUNT_ERC20)
            await erc20.connect(users[1]).increaseAllowance(marketplace.address, AMOUNT_ERC20)
            await marketplace.connect(users[1]).buyNft(erc20.address, erc721.address, NFT_ID)

            expect(await erc20.balanceOf(users[1].address)).to.be.eq(0)
            expect(await erc20.balanceOf(treasury.address)).to.be.eq(AMOUNT_ERC20.mul(MARKETPLACE_FEE).div(100))
            expect(await erc20.balanceOf(users[0].address)).to.be.eq(AMOUNT_ERC20.mul(100 - MARKETPLACE_FEE).div(100))
        });
        it("user can buy nft from the marketplace with ether", async () => {
            const SELLER_BALANCE_BEFORE = await ethers.provider.getBalance(users[0].address)
            const BUYER_BALANCE_BEFORE = await ethers.provider.getBalance(users[1].address)
            const NFT_ID = 1
            // const NFT_PRICE = 1e8 // 1 usd with decimal 8
            const NFT_PRICE = ethers.BigNumber.from(100e8); // 100 USDT
            
            await erc721.mint(users[0].address, NFT_ID)
                
            let receipt = await(
                await erc721.connect(users[0]).approve(marketplace.address, NFT_ID)
                ).wait()
            const GAS_USED_APPROVE = (receipt.gasUsed).mul(receipt.effectiveGasPrice)

            const SALE_DEAD_LINE = (await ethers.provider.getBlock("latest")).timestamp + 24*3600
            receipt = await(
                await marketplace.connect(users[0]).listNft(erc721.address, NFT_ID, NFT_PRICE, SALE_DEAD_LINE)
                ).wait()
            const GAS_USED_LISTING = (receipt.gasUsed).mul(receipt.effectiveGasPrice)

            const ETHER_RATE = await marketplace.getTokenPrice(oracleEther.address)
            const AMOUNT_ETHER = NFT_PRICE.mul(ERC20_DECIMALS).div(ETHER_RATE)

            receipt = await(
                await marketplace.connect(users[1]).buyNftWithEther(oracleEther.address, erc721.address, NFT_ID, {value: AMOUNT_ETHER})
                ).wait()
            const GAS_USED_BUYING = (receipt.gasUsed).mul(receipt.effectiveGasPrice)

            expect(await ethers.provider.getBalance(users[0].address))
                .to.be.eq(
                    SELLER_BALANCE_BEFORE.sub(GAS_USED_APPROVE).sub(GAS_USED_LISTING)
                    .add(AMOUNT_ETHER.mul(90).div(100))
                )
            expect(await ethers.provider.getBalance(users[1].address))
                .to.be.eq(
                    BUYER_BALANCE_BEFORE.sub(GAS_USED_BUYING).sub(AMOUNT_ETHER)
                )
            expect(await ethers.provider.getBalance(treasury.address)).to.be.eq(AMOUNT_ETHER.mul(MARKETPLACE_FEE).div(100))

            expect(await erc721.ownerOf(NFT_ID)).to.be.eq(users[1].address)
        });
        it("user can buy nft from the marketplace with ether [OVERPAY]", async () => {
            const SELLER_BALANCE_BEFORE = await ethers.provider.getBalance(users[0].address)
            const BUYER_BALANCE_BEFORE = await ethers.provider.getBalance(users[1].address)
            const NFT_ID = 1
            // const NFT_PRICE = 1e8 // 1 usd with decimal 8
            const NFT_PRICE = ethers.BigNumber.from(100e8); // 100 USDT
            
            await erc721.mint(users[0].address, NFT_ID)
                
            let receipt = await(
                await erc721.connect(users[0]).approve(marketplace.address, NFT_ID)
                ).wait()
            const GAS_USED_APPROVE = (receipt.gasUsed).mul(receipt.effectiveGasPrice)

            const SALE_DEAD_LINE = (await ethers.provider.getBlock("latest")).timestamp + 24*3600
            receipt = await(
                await marketplace.connect(users[0]).listNft(erc721.address, NFT_ID, NFT_PRICE, SALE_DEAD_LINE)
                ).wait()
            const GAS_USED_LISTING = (receipt.gasUsed).mul(receipt.effectiveGasPrice)

            const ETHER_RATE = await marketplace.getTokenPrice(oracleEther.address)
            const AMOUNT_ETHER = NFT_PRICE.mul(ERC20_DECIMALS).div(ETHER_RATE)

            receipt = await(
                await marketplace.connect(users[1]).buyNftWithEther(oracleEther.address, erc721.address, NFT_ID, {value: AMOUNT_ETHER.mul(2)})
                ).wait()
            const GAS_USED_BUYING = (receipt.gasUsed).mul(receipt.effectiveGasPrice)

            expect(await ethers.provider.getBalance(users[0].address))
                .to.be.eq(
                    SELLER_BALANCE_BEFORE.sub(GAS_USED_APPROVE).sub(GAS_USED_LISTING)
                    .add(AMOUNT_ETHER.mul(90).div(100))
                )
            expect(await ethers.provider.getBalance(users[1].address))
                .to.be.eq(
                    BUYER_BALANCE_BEFORE.sub(GAS_USED_BUYING).sub(AMOUNT_ETHER)
                )
            expect(await ethers.provider.getBalance(treasury.address)).to.be.eq(AMOUNT_ETHER.mul(MARKETPLACE_FEE).div(100))

            expect(await erc721.ownerOf(NFT_ID)).to.be.eq(users[1].address)
        });
        it("user cannot buy nft from the marketplace with not sufficient payment", async () => {
            const NFT_ID = 1
            // const NFT_PRICE = 1e8 // 1 usd with decimal 8
            const NFT_PRICE = ethers.BigNumber.from(100e8); // 100 USDT
            await erc721.mint(users[0].address, NFT_ID)
            await erc721.connect(users[0]).approve(marketplace.address, NFT_ID)

            const SALE_DEAD_LINE = (await ethers.provider.getBlock("latest")).timestamp + 24*3600
            await marketplace.connect(users[0]).listNft(erc721.address, NFT_ID, NFT_PRICE, SALE_DEAD_LINE)

            const ERC20_RATE = await marketplace.getTokenPrice(erc20.address)
            const AMOUNT_ERC20 = NFT_PRICE.div(ERC20_RATE).mul(ERC20_DECIMALS)
            
            await erc20.mint(users[1].address, AMOUNT_ERC20)
            await erc20.connect(users[1]).increaseAllowance(marketplace.address, AMOUNT_ERC20.sub(1))
            await expect(marketplace.connect(users[1]).buyNft(erc20.address, erc721.address, NFT_ID))
                .to.be.revertedWith("ERC20: insufficient allowance") 
        });
        it("user cannot buy nft from the marketplace after nft sale deadline", async () => {
            const NFT_ID = 1
            // const NFT_PRICE = 1e8 // 1 usd with decimal 8
            const NFT_PRICE = ethers.BigNumber.from(100e8); // 100 USDT
            await erc721.mint(users[0].address, NFT_ID)
            await erc721.connect(users[0]).approve(marketplace.address, NFT_ID)

            const SALE_DEAD_LINE = (await ethers.provider.getBlock("latest")).timestamp + 24*3600
            await marketplace.connect(users[0]).listNft(erc721.address, NFT_ID, NFT_PRICE, SALE_DEAD_LINE)

            const ERC20_RATE = await marketplace.getTokenPrice(erc20.address)
            const AMOUNT_ERC20 = NFT_PRICE.div(ERC20_RATE).mul(ERC20_DECIMALS)
            
            await erc20.mint(users[1].address, AMOUNT_ERC20)
            await erc20.connect(users[1]).increaseAllowance(marketplace.address, AMOUNT_ERC20)

            await time.increase(24*3600)

            await expect(marketplace.connect(users[1]).buyNft(erc20.address, erc721.address, NFT_ID))
                .to.be.revertedWith("Nft cannot be bought after sale deadline") 
        });
        it("user can unlist nft from the marketplace", async () => {
            const NFT_ID = 1
            const NFT_PRICE = 1e8 // 1 usd with decimal 8
            await erc721.mint(users[0].address, NFT_ID)
            await erc721.connect(users[0]).approve(marketplace.address, NFT_ID)

            const SALE_DEAD_LINE = (await ethers.provider.getBlock("latest")).timestamp + 24*3600
            
            await marketplace.connect(users[0]).listNft(erc721.address, NFT_ID, NFT_PRICE, SALE_DEAD_LINE)
            
            await marketplace.connect(users[0]).unlistNft(erc721.address, NFT_ID)
   

        });
        it("place bet", async () => {
            const NFT_ID = 1
        
            const START_PRICE = ethers.BigNumber.from(100e8); // 100 USDT
            await erc721.mint(users[0].address, NFT_ID)
            await erc721.connect(users[0]).approve(marketplace.address, NFT_ID)

            const AUCTION_DEADLINE = (await ethers.provider.getBlock("latest")).timestamp + 24 * 3600
            await marketplace.connect(users[0]).listNftForAuction(erc721.address, NFT_ID, START_PRICE, AUCTION_DEADLINE)

            const ERC20_RATE = await marketplace.getTokenPrice(erc20.address)
            const AMOUNT_ERC20 = START_PRICE.mul(ERC20_DECIMALS).div(ERC20_RATE)
            
            await erc20.mint(users[1].address, AMOUNT_ERC20)
            await erc20.connect(users[1]).increaseAllowance(marketplace.address, AMOUNT_ERC20)
            await marketplace.connect(users[1]).placeBet(erc20.address, AMOUNT_ERC20, erc721.address, NFT_ID)
            await marketplace.connect(users[0]).acceptBet(0, erc721.address, NFT_ID)

        });
        it("place bet [multiple bets]", async () => {
            const NFT_ID = 1
        
            const START_PRICE = ethers.BigNumber.from(100e8); // 100 USDT
            await erc721.mint(users[0].address, NFT_ID)
            await erc721.connect(users[0]).approve(marketplace.address, NFT_ID)

            const AUCTION_DEADLINE = (await ethers.provider.getBlock("latest")).timestamp + 24 * 3600
            await marketplace.connect(users[0]).listNftForAuction(erc721.address, NFT_ID, START_PRICE, AUCTION_DEADLINE)

            const ERC20_RATE = await marketplace.getTokenPrice(erc20.address)
            const AMOUNT_ERC20 = START_PRICE.mul(ERC20_DECIMALS).div(ERC20_RATE)
            
            await erc20.mint(users[1].address, AMOUNT_ERC20)
            await erc20.connect(users[1]).increaseAllowance(marketplace.address, AMOUNT_ERC20)
            await marketplace.connect(users[1]).placeBet(erc20.address, AMOUNT_ERC20, erc721.address, NFT_ID)

            const AMOUNT_ERC20_USER_2 = START_PRICE.mul(ERC20_DECIMALS).div(ERC20_RATE).mul(2)
            await erc20.mint(users[2].address, AMOUNT_ERC20_USER_2)
            await erc20.connect(users[2]).increaseAllowance(marketplace.address, AMOUNT_ERC20_USER_2)
            await marketplace.connect(users[2]).placeBet(erc20.address, AMOUNT_ERC20_USER_2, erc721.address, NFT_ID)

            console.log(await marketplace.getBets(erc721.address, NFT_ID))
            console.log()

            await marketplace.connect(users[0]).acceptBet(1, erc721.address, NFT_ID)

            console.log(await marketplace.getBets(erc721.address, NFT_ID))

        });
        it("cancel bet [multiple bets]", async () => {
            const NFT_ID = 1
        
            const START_PRICE = ethers.BigNumber.from(100e8); // 100 USDT
            await erc721.mint(users[0].address, NFT_ID)
            await erc721.connect(users[0]).approve(marketplace.address, NFT_ID)

            const AUCTION_DEADLINE = (await ethers.provider.getBlock("latest")).timestamp + 24 * 3600
            await marketplace.connect(users[0]).listNftForAuction(erc721.address, NFT_ID, START_PRICE, AUCTION_DEADLINE)

            const ERC20_RATE = await marketplace.getTokenPrice(erc20.address)
            const AMOUNT_ERC20 = START_PRICE.mul(ERC20_DECIMALS).div(ERC20_RATE)
            
            await erc20.mint(users[1].address, AMOUNT_ERC20)
            await erc20.connect(users[1]).increaseAllowance(marketplace.address, AMOUNT_ERC20)
            await marketplace.connect(users[1]).placeBet(erc20.address, AMOUNT_ERC20, erc721.address, NFT_ID)

            const AMOUNT_ERC20_USER_2 = START_PRICE.mul(ERC20_DECIMALS).div(ERC20_RATE).mul(2)
            await erc20.mint(users[2].address, AMOUNT_ERC20_USER_2)
            await erc20.connect(users[2]).increaseAllowance(marketplace.address, AMOUNT_ERC20_USER_2)
            await marketplace.connect(users[2]).placeBet(erc20.address, AMOUNT_ERC20_USER_2, erc721.address, NFT_ID)

            console.log(await marketplace.getBets(erc721.address, NFT_ID))
            console.log()
            const BET_ID = 0
            await marketplace.connect(users[1]).cancelBet(BET_ID, erc721.address, NFT_ID)
            // await marketplace.connect(users[0]).acceptBet(1, erc721.address, NFT_ID)
            expect(await erc20.balanceOf(users[1].address)).to.be.eq(AMOUNT_ERC20)

            console.log(await marketplace.getBets(erc721.address, NFT_ID))

        });
        it("user cannot cancel other user bet", async () => {
            const NFT_ID = 1
        
            const START_PRICE = ethers.BigNumber.from(100e8); // 100 USDT
            await erc721.mint(users[0].address, NFT_ID)
            await erc721.connect(users[0]).approve(marketplace.address, NFT_ID)

            const AUCTION_DEADLINE = (await ethers.provider.getBlock("latest")).timestamp + 24 * 3600
            await marketplace.connect(users[0]).listNftForAuction(erc721.address, NFT_ID, START_PRICE, AUCTION_DEADLINE)

            const ERC20_RATE = await marketplace.getTokenPrice(erc20.address)
            const AMOUNT_ERC20 = START_PRICE.mul(ERC20_DECIMALS).div(ERC20_RATE)
            
            await erc20.mint(users[1].address, AMOUNT_ERC20)
            await erc20.connect(users[1]).increaseAllowance(marketplace.address, AMOUNT_ERC20)
            await marketplace.connect(users[1]).placeBet(erc20.address, AMOUNT_ERC20, erc721.address, NFT_ID)

            const AMOUNT_ERC20_USER_2 = START_PRICE.mul(ERC20_DECIMALS).div(ERC20_RATE).mul(2)
            await erc20.mint(users[2].address, AMOUNT_ERC20_USER_2)
            await erc20.connect(users[2]).increaseAllowance(marketplace.address, AMOUNT_ERC20_USER_2)
            await marketplace.connect(users[2]).placeBet(erc20.address, AMOUNT_ERC20_USER_2, erc721.address, NFT_ID)

            const BET_ID = 1
            await expect(
                marketplace.connect(users[1]).cancelBet(BET_ID, erc721.address, NFT_ID)
            ).to.be.revertedWith("It is not your bet")    
        });
        it("user cannot bet for NFT which is not on action but on sale", async () => {
            const NFT_ID = 1
            // const NFT_PRICE = 1e8 // 1 usd with decimal 8
            const NFT_PRICE = ethers.BigNumber.from(100e8); // 100 USDT
            await erc721.mint(users[0].address, NFT_ID)
            await erc721.connect(users[0]).approve(marketplace.address, NFT_ID)

            const SALE_DEAD_LINE = (await ethers.provider.getBlock("latest")).timestamp + 24*3600
            await marketplace.connect(users[0]).listNft(erc721.address, NFT_ID, NFT_PRICE, SALE_DEAD_LINE)

            const ERC20_RATE = await marketplace.getTokenPrice(erc20.address)
            const AMOUNT_ERC20 = NFT_PRICE.mul(ERC20_DECIMALS).div(ERC20_RATE)
            
            await erc20.mint(users[1].address, AMOUNT_ERC20)
            await erc20.connect(users[1]).increaseAllowance(marketplace.address, AMOUNT_ERC20)
            await expect(
                marketplace.connect(users[1]).placeBet(erc20.address, AMOUNT_ERC20, erc721.address, NFT_ID)
            ).to.be.revertedWith("NFT is not on marketplace auction")
        });

    });

});
