// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract ProofOfReading is Ownable {

    struct Article {
        uint256 id;
        string  title;
        string  url;
        string  description;
        uint256 burnCost;
        uint256 publishedAt;
        uint256 readCount;
        bool    active;
    }

    ERC20Burnable public devToken;

    Article[] public articles;
    uint256   public articleCount;
    uint256   public totalTokensBurned;

    mapping(uint256 => mapping(address => bool))    public hasRead;
    mapping(address => uint256[])                   public articlesReadBy;
    mapping(address => uint256)                     public totalBurnedBy;

    event ArticlePublished(uint256 indexed id, string title, uint256 burnCost, uint256 timestamp);
    event ArticleRead(uint256 indexed articleId, address indexed reader, uint256 burnCost, uint256 timestamp);

    constructor(address _devToken) Ownable(msg.sender) {
        devToken = ERC20Burnable(_devToken);
    }

    function publish(
        string calldata title,
        string calldata url,
        string calldata description,
        uint256 burnCost
    ) external onlyOwner returns (uint256 id) {
        require(bytes(title).length > 0, "Title required");
        require(burnCost > 0, "Burn cost must be > 0");

        id = articleCount++;
        articles.push(Article({
            id:          id,
            title:       title,
            url:         url,
            description: description,
            burnCost:    burnCost,
            publishedAt: block.timestamp,
            readCount:   0,
            active:      true
        }));

        emit ArticlePublished(id, title, burnCost, block.timestamp);
    }

    function markAsRead(uint256 articleId) external {
        require(articleId < articleCount, "Article not found");
        Article storage a = articles[articleId];
        require(a.active, "Article inactive");
        require(!hasRead[articleId][msg.sender], "Already marked as read");

        devToken.burnFrom(msg.sender, a.burnCost);

        hasRead[articleId][msg.sender] = true;
        a.readCount++;
        articlesReadBy[msg.sender].push(articleId);
        totalBurnedBy[msg.sender]  += a.burnCost;
        totalTokensBurned          += a.burnCost;

        emit ArticleRead(articleId, msg.sender, a.burnCost, block.timestamp);
    }

    function deactivate(uint256 id) external onlyOwner {
        require(id < articleCount, "Article not found");
        articles[id].active = false;
    }

    function getAllArticles() external view returns (Article[] memory) {
        return articles;
    }

    function getReadHistory(address reader) external view returns (uint256[] memory) {
        return articlesReadBy[reader];
    }
}
