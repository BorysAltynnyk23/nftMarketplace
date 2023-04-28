// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "hardhat/console.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";



contract Marketplace is OwnableUpgradeable {
    // _______________ Storage _______________
    string private greeting;
    uint256 public sellFee;
    
    /// @dev NFT Contract => NFT ID => Price in USD
    mapping(address => mapping(uint256 => uint256)) public nftPrice;
    mapping(address => mapping(uint256 => address)) public nftOwner;
    mapping(address => bool) public isPaymentToken;

    mapping(address => AggregatorV3Interface) public tokenToOracle;


    // _______________ Events _______________
    /// @dev Emitted when user offer nft for sale on marketplace
    event NftIsListed (address _seller, address _nftContract, uint256 _nftId, uint256 _nftPrice);
    // event NftIsBought (address _seller, address _nftContract, uint256 _nftId, uint256 _nftPrice);

    // _______________ Initializer _______________

    function initialize() external initializer{
        __Ownable_init();
        sellFee = 1000; // 1000 = 10%
    } 

    // _______________ External functions _______________
    /**
     * @notice Let user lsit NFT for sale on marketplace
     *
     * @param _nftContract nft contract
     * @param _nftId nft id
     * @param _nftPrice nft price in USD
     * @param _saleDeadLine moment in future before nft can be sold
     */
    function listNft(address _nftContract, uint256 _nftId, uint256 _nftPrice, uint256 _saleDeadLine) external{
        IERC721Upgradeable(_nftContract).transferFrom(msg.sender, address(this), _nftId);
        nftPrice[_nftContract][_nftId] = _nftPrice;
        nftOwner[_nftContract][_nftId] = msg.sender;
        emit NftIsListed(msg.sender, _nftContract, _nftId, _nftPrice);
    }

    /**
     * @notice Let user buy NFT from marketplace
     *
     * @param _tokenOfPayment token of payment
     * @param _nftContract nft contract
     * @param _nftId nft id
     * 
     */

    function buyNft(address _tokenOfPayment, address _nftContract, uint256 _nftId) external{
        require(nftPrice[_nftContract][_nftId] != 0, "NFT is not on marketplace");
        require(isPaymentToken[_tokenOfPayment], "Payment token is not supported");

        uint256 paymentTokenPrice = uint256(getTokenPrice(_tokenOfPayment)); // Token / USD 

        uint256 nftPriceInTokens =  nftPrice[_nftContract][_nftId] / paymentTokenPrice * 1e18;

        IERC20Upgradeable(_tokenOfPayment).transferFrom(msg.sender, address(this), nftPriceInTokens);
        nftPrice[_nftContract][_nftId] = 0;
        IERC721Upgradeable(_nftContract).transferFrom(address(this), msg.sender, _nftId);
    }

    function setPaymentToken(address _token, address _oracle, bool _isPaymentToken) external onlyOwner{
        isPaymentToken[_token] = _isPaymentToken;
        tokenToOracle[_token] = AggregatorV3Interface(_oracle);
    }

    function getTokenPrice(address _token) public view returns (int) {
        (
            /* uint80 roundID */,
            int price,
            /*uint startedAt*/,
            /*uint timeStamp*/,
            /*uint80 answeredInRound*/
        ) = tokenToOracle[_token].latestRoundData();
        return price;
    }

    function setMarketplaceFee(uint256 _fee) external onlyOwner{
        sellFee  = _fee;
    }

}
