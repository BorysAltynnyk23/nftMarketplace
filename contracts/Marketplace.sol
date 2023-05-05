// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "hardhat/console.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract Marketplace is OwnableUpgradeable {
    //________________ Structs ______________
    struct Bet { 
    address bettor;
    address tokenContract;
    uint256 tokenAmount;
    }
    // _______________ Storage _______________
    string private greeting;
    uint256 public sellFee;
    uint256 public constant PRECISION = 10000;
    address public treasury;
    address public etherOracle;
    
    /// @dev NFT Contract => NFT ID => Price in USD
    mapping(address => mapping(uint256 => uint256)) public nftPrice;
    mapping(address => mapping(uint256 => uint256)) public auctionStartPrice;
    mapping(address => mapping(uint256 => uint256)) public nftSaleDeadline;
    mapping(address => mapping(uint256 => uint256)) public auctionDeadline;
    mapping(address => mapping(uint256 => address)) public nftOwner;
    
    /// @dev NFT Contract => NFT ID => bet
    mapping(address => mapping(uint256 => Bet[])) public bets;

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
     * @notice Let user list NFT for sale on marketplace
     *
     * @param _nftContract nft contract
     * @param _nftId nft id
     * @param _nftPrice nft price in USD 8 decimals
     * @param _saleDeadLine moment in future before nft can be sold
     */
    function listNft(address _nftContract, uint256 _nftId, uint256 _nftPrice, uint256 _saleDeadLine) external{
        require(_nftPrice != 0, "Start price cannot be zero");
        IERC721Upgradeable(_nftContract).transferFrom(msg.sender, address(this), _nftId);
        nftPrice[_nftContract][_nftId] = _nftPrice;
        nftOwner[_nftContract][_nftId] = msg.sender;
        nftSaleDeadline[_nftContract][_nftId] = _saleDeadLine;
        emit NftIsListed(msg.sender, _nftContract, _nftId, _nftPrice);
    }
    
    function unlistNft(address _nftContract, uint256 _nftId) external{
        require(nftOwner[_nftContract][_nftId] == msg.sender, "You are not the owner of this nft");
        IERC721Upgradeable(_nftContract).transferFrom(address(this), msg.sender, _nftId);

        deleteNft(_nftContract, _nftId);
    }

    function listNftForAuction(address _nftContract, uint256 _nftId, uint256 _startPrice, uint256 _auctionDeadLine) external{
        require(_startPrice != 0, "Start price cannot be zero");
        IERC721Upgradeable(_nftContract).transferFrom(msg.sender, address(this), _nftId);
        auctionStartPrice[_nftContract][_nftId] = _startPrice;
        nftOwner[_nftContract][_nftId] = msg.sender;
        auctionDeadline[_nftContract][_nftId] = _auctionDeadLine;
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
        require(block.timestamp < nftSaleDeadline[_nftContract][_nftId], "Nft cannot be bought after sale deadline");

        uint256 paymentTokenPrice = uint256(getTokenPrice(_tokenOfPayment)); //  USD/Token 
        uint256 nftPriceInTokens =  nftPrice[_nftContract][_nftId] / paymentTokenPrice * 10**ERC20Upgradeable(_tokenOfPayment).decimals();
        uint256 fee = nftPriceInTokens * sellFee / PRECISION;

        IERC20Upgradeable(_tokenOfPayment).transferFrom(msg.sender, treasury, fee);

        IERC20Upgradeable(_tokenOfPayment).transferFrom(msg.sender, nftOwner[_nftContract][_nftId], nftPriceInTokens - fee);

        IERC721Upgradeable(_nftContract).transferFrom(address(this), msg.sender, _nftId);

        deleteNft(_nftContract, _nftId);
    }

    // @dev you have to pass oracle address for ETH/USDT 
    function buyNftWithEther(address _tokenOfPayment, address _nftContract, uint256 _nftId) external payable{
        require(nftPrice[_nftContract][_nftId] != 0, "NFT is not on marketplace");
        require(isPaymentToken[_tokenOfPayment], "Payment token is not supported");
        require(block.timestamp < nftSaleDeadline[_nftContract][_nftId], "Nft cannot be bought after sale deadline");

        uint256 etherPrice = uint256(getTokenPrice(_tokenOfPayment)); //  USD/Token 

        uint256 nftPriceInEther =  nftPrice[_nftContract][_nftId] * 10**18 / etherPrice ;
        require(msg.value >= nftPriceInEther, "Not enough ether to by nft");
        uint256 fee = nftPriceInEther * sellFee / PRECISION;
        // address.transfer(amount);
        address payable owner = payable(nftOwner[_nftContract][_nftId]);
        bool sent;
        bytes memory data;
        ( sent, data) = owner.call{value: nftPriceInEther - fee}("");
        require(sent, "Failed to send Ether");
        
        ( sent, data) = treasury.call{value: fee}("");
        require(sent, "Failed to send Ether");

        if(msg.value > nftPriceInEther){
            address payable buyer = payable(msg.sender);

            (sent, data) = buyer.call{value: msg.value - nftPriceInEther}("");
            require(sent, "Failed to send Ether");
        }

        IERC721Upgradeable(_nftContract).transferFrom(address(this), msg.sender, _nftId);

        deleteNft(_nftContract, _nftId);
    }

    /**
     * @notice Let user place bet for NFT auction
     *
     * @param _tokenOfPayment token of payment
     * @param _nftContract nft contract
     * @param _bet bet in tokens
     * @param _nftId nft id
     * 
     */
    function placeBet(address _tokenOfPayment, uint256 _bet, address _nftContract, uint256 _nftId) external{
        require(auctionStartPrice[_nftContract][_nftId] != 0, "NFT is not on marketplace auction");
        require(isPaymentToken[_tokenOfPayment], "Payment token is not supported");
        require(block.timestamp < auctionDeadline[_nftContract][_nftId], "Bet cannot be placed after deadline");

        IERC20Upgradeable(_tokenOfPayment).transferFrom(msg.sender, address(this), _bet);

        uint256 paymentTokenPrice = uint256(getTokenPrice(_tokenOfPayment)); //  USD/Token 
        uint256 betUsdValue = _bet * paymentTokenPrice / 10**ERC20Upgradeable(_tokenOfPayment).decimals();

        require(betUsdValue >= auctionStartPrice[_nftContract][_nftId], "Bet is too small");

        bets[_nftContract][_nftId].push(Bet( msg.sender, _tokenOfPayment, _bet));
    }
    // @dev _tokenOfPayment - you have to pass oracle for ether
    function placeBetEther(address _nftContract, uint256 _nftId) external payable{
        require(auctionStartPrice[_nftContract][_nftId] != 0, "NFT is not on marketplace auction");
        require(isPaymentToken[etherOracle], "Payment token is not supported");
        require(block.timestamp < auctionDeadline[_nftContract][_nftId], "Bet cannot be placed after deadline");

        uint256 paymentTokenPrice = uint256(getTokenPrice(etherOracle)); //  USD/Ether 
        uint256 betUsdValue = msg.value * paymentTokenPrice / 10**18;

        require(betUsdValue >= auctionStartPrice[_nftContract][_nftId], "Bet is too small");

        bets[_nftContract][_nftId].push(Bet( msg.sender, etherOracle, msg.value));
    }

    function cancelBet(uint256 _betId, address _nftContract, uint256 _nftId) external{
        require(bets[_nftContract][_nftId][_betId].bettor == msg.sender, "It is not your bet");

        Bet storage bet = bets[_nftContract][_nftId][_betId];

        IERC20Upgradeable(bet.tokenContract).transfer(bet.bettor, bet.tokenAmount);

        deleteBet(_nftContract, _nftId, _betId);
    }
    
    function cancelBetEther(uint256 _betId, address _nftContract, uint256 _nftId) external{
        require(bets[_nftContract][_nftId][_betId].bettor == msg.sender, "It is not your bet");

        Bet storage bet = bets[_nftContract][_nftId][_betId];

        (bool sent, bytes memory data) = bet.bettor.call{value: bet.tokenAmount}("");
        require(sent, "Failed to send Ether");

        deleteBet(_nftContract, _nftId, _betId);
    }

    function acceptBet(uint256 _betId, address _nftContract, uint256 _nftId) external{
        require(nftOwner[_nftContract][_nftId] == msg.sender, "You are not nft owner");

        Bet storage bet = bets[_nftContract][_nftId][_betId];
        uint256 fee = bet.tokenAmount * sellFee / PRECISION;
        if(bet.tokenContract == etherOracle){
            bool sent;
            bytes memory data;
            (sent, data) = nftOwner[_nftContract][_nftId].call{value: bet.tokenAmount - fee}("");
            require(sent, "Failed to send Ether");

            (sent, data) = treasury.call{value: fee}("");
            require(sent, "Failed to send Ether");
        }else
        {
            IERC20Upgradeable(bet.tokenContract).transfer(nftOwner[_nftContract][_nftId], bet.tokenAmount - fee);
            IERC20Upgradeable(bet.tokenContract).transfer(treasury, fee);
        }

        IERC721Upgradeable(_nftContract).transferFrom(address(this), bet.bettor, _nftId);
        deleteNftFromAuction(_nftContract, _nftId, _betId);
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
    
    function setTreasury(address _treasury) external onlyOwner{
        treasury  = _treasury;
    }
    
    function setEtherOracle(address _etherOracle) external onlyOwner{
        etherOracle  = _etherOracle;
    }
    // _______________ Internal functions _______________

    function deleteNft(address _nftContract, uint256 _nftId) internal {
        delete nftPrice[_nftContract][_nftId];
        delete nftSaleDeadline[_nftContract][_nftId];
        delete nftOwner[_nftContract][_nftId];
    }

    function deleteNftFromAuction(address _nftContract, uint256 _nftId, uint256 _betId) internal {
        delete auctionStartPrice[_nftContract][_nftId];
        delete nftOwner[_nftContract][_nftId];
        delete auctionDeadline[_nftContract][_nftId];
        
        deleteBet(_nftContract, _nftId, _betId);
    }

    function deleteBet(address _nftContract, uint256 _nftId, uint256 _betId) internal{
        Bet [] storage bet = bets[_nftContract][_nftId];
        bet[_betId] = bet[bet.length - 1];
        bet.pop(); // works fine even with bet.length == 1
    }

    function getBets(address _nftContract, uint256 _nftId) external view returns(Bet [] memory) {
        return bets[_nftContract][_nftId];
    }

}

