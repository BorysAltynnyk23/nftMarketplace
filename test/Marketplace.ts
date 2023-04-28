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
    OracleMock
} from "../typechain-types";


describe("Marketplace", function () {
    let snapshotA: SnapshotRestorer

    // Signers.
    let deployer: SignerWithAddress
    let users: SignerWithAddress[]

    let marketplace: Marketplace
    let erc20: ERC20Mock
    let erc721: ERC721Mock
    let oracle: OracleMock

    const USD_DECIMALS = 1e8
    const ERC20_DECIMALS = ethers.utils.parseEther("1")

    // const erc20Rate = ethers.utils.parseEther('10') // 10 tokens for 1 usd

    before(async () => {
        // Getting of signers.
        let signers = await ethers.getSigners()
        deployer = signers[0]
        users = signers.slice(10, 20)
        
        const ERC20Mock = await ethers.getContractFactory("ERC20Mock", deployer)
        erc20 = await ERC20Mock.deploy()
        await erc20.deployed()

        const OracleMock = await ethers.getContractFactory("OracleMock", deployer)
        oracle = await OracleMock.deploy()
        await oracle.deployed()


        const ERC721Mock = await ethers.getContractFactory("ERC721Mock", deployer)
        erc721 = await ERC721Mock.deploy()
        await erc721.deployed()

        const MarketPlace = await ethers.getContractFactory("Marketplace", deployer)
        marketplace = await upgrades.deployProxy(MarketPlace, []) as Marketplace
        await marketplace.deployed()
        await marketplace.setPaymentToken(erc20.address, oracle.address, true)

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
            const AMOUNT_ERC20 = NFT_PRICE.div(ERC20_RATE).mul(ERC20_DECIMALS)
            
            await erc20.mint(users[1].address, AMOUNT_ERC20)
            await erc20.connect(users[1]).increaseAllowance(marketplace.address, AMOUNT_ERC20)
            await marketplace.connect(users[1]).buyNft(erc20.address, erc721.address, NFT_ID)

            expect(await erc20.balanceOf(users[1].address)).to.be.eq(0)
            expect(await erc20.balanceOf(marketplace.address)).to.be.eq(AMOUNT_ERC20)
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
                .to.be.revertedWith("Nft cannot be bought due to sale deadline") 
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

    });

});
