// This is include-able both in a browser environment and in a v8/node env,
// so it needs to figure out which situation it is in. If it's on the server,
// put everything in exports and behave like a module. If it's on the client,
// fake it and expect the client to understand how to deal with things.
(function () {
  var server = false,
    model;
  if (typeof exports !== 'undefined') {
    model = exports;
    server = true;
    
    _ = require('underscore');
    Backbone = require('backbone');
    
  } else {
    model = this.model = {};
  }


model.Post = Backbone.Model.extend({
    
    initialize: function(args) {
        Backbone.Model.prototype.initialize.call(this, args);
    },
    
    defaults: function() {
        return {
            fromName: "default name",
            fromAffiliation: "nowhere",
            fromId: -1,
            text: "default text",
            timestamp: new Date().getTime(),
            votes: [],
            promotedAt: null,
            event: null,
        };
    },
    
    addVote: function(fromUserId, atTimestamp, silent) {
        // console.log("incoming: " + atTimestamp + " / " + fromUserId);
        
        if (_.isUndefined(atTimestamp) || _.isNull(atTimestamp)) {
            atTimestamp = Date.now();
        }
        
        if(_.isUndefined(fromUserId)) {
            fromUserId = null;
        }
        
        if(_.isUndefined(silent))
            silent = false;
        
        if(fromUserId instanceof model.User) {
            console.log("Tried to pass in a User object when addVote expects an id. Fixing the problem, but fix your code!");
            fromUserId = fromUserId.id;
        }
        
        // reject votes from the same person
        if(this.hasVoteFrom(fromUserId)) return false;
        
        var currentVoteList = this.get("votes");
        currentVoteList.push({"timestamp":atTimestamp, "id":fromUserId});
        this.set({
            "votes": currentVoteList
        });
        
        // this is a sort of annoying hack because if this is run in server
        // mode we don't want to double-trigger vote - let the superclass do
        // the triggering. 
        if(!silent) this.trigger("vote");
        return true;
    },
    
    votes: function() {
        return this.get("votes").length;
    },
    
    recentVotes: function(since) {
        if(_.isUndefined(since) || _.isNull(since)) {
            // If since isn't passed in, default to 2 minutes.
            since = 120*1000;
        }
        
        var numVoteInWindow = 0;
        var curTime = Date.now();
        
        
        var votesInWindow = _.filter(this.get("votes"), function(vote) {
            return (curTime - vote["timestamp"]) < since
        });
        
        return votesInWindow.length;
    },
    
    mostRecentVote: function() {
        var sortedVotes = _.sortBy(this.get("votes"), function(vote) {
            return vote["timestamp"];
        });
        sortedVotes.reverse();
        return sortedVotes[0];
    },
    
    hasVoteFrom: function(userId) {
        return _.find(this.get("votes"), function(vote) {
            return vote["id"]==userId;
        })!=null;
    },
    
    getScore: function() {
        // We're going to do this cherrie's way because it's super
        // computationally inexpensive. Just compare the vote times to the
        // event start times (times some scaling factor) and we have our
        // time-adjusted score. This does cause rampant score inflation, but
        // since scores are never exposed to the client, it's not that big
        // a deal.
        
        // loop across each vote, checking how old it is and assigning 
        // score points appropriately.
        
        if(_.isNull(this.get("event"))) {
            // This should not happen! Event is a required parameters.
            console.log("Tried to getScore() without the post having an event context set. Returning 0.");
            return 0;
        }
        
        return _.reduce(this.get("votes"), function(memo, vote) {
            return memo + 1 + 
                ((vote["timestamp"] - this.get("event").get("start")) * 
                this.get("event").get("voteTimeScoreFactor"))
        }, 0, this);
    },
    
    promote: function(promotedAt) {
        
        if(_.isUndefined(promotedAt) || _.isNull(promotedAt)) {
            promotedAt = new Date().getTime();
        }
        
        this.set({"promotedAt": promotedAt});
    },
    
    isPromoted: function() {
        return !(_.isNull(this.get("promotedAt")));
    }
});


model.User = Backbone.Model.extend({
    
    defaults: function() {
        return {
            name: "default name",
            affiliation: "default affiliation",
        };
    },
    
    // Leaving this here but not actually testing it yet. Validate is 
    // basically broken right now for my purposes. It isn't called on 
    // object construction, which is the majority of the times I would
    // actually want it to be used. It's only called on set() and save(),
    // the latter of which I never use because I'm not using that part of
    // backbone. There are a zillion issues in their bug tracker about this 
    // with no solution forthcoming yet.
    validate: function(attributes) {
        if("name" in attributes) {
            if(attributes.name.length > 30) {
                return "'" + attributes.name + "' is too long a name. It must be less than 30 characters.";
            }
            
            if(attributes.affiliation.length>30) {
                return "'" + attributes.affiliation + "' is too long an affiliation. It must be less than 30 characters.";
            }
        }
    }
});

model.Chat = Backbone.Model.extend({
    defaults: function() {
        return {
            fromName: "default",
            fromAffiliation: "default affiliation",
            fromId: -1,
            text: "default message",
            timestamp: new Date().getTime(),
            admin: false
        }
    },
});

model.PostList = Backbone.Collection.extend({
    
    "model":model.Post,
    
    // TODO think about this - in some contexts we want to sort on score,
    // in others we want to sort by time. Do we make these different a switch
    // on this list type?
    comparator: function(post) {
        return -1*post.getScore();
    },
    
    add: function(newPost) {
        Backbone.Collection.prototype.add.call(this, newPost);
        
        // register a listener on the vote listener, because that
        // should cause a re-sort.
        newPost.bind("vote", function() {
            this.sort();
        }, this);
    },
    
    getPostRank: function(post) {
        // we can just use indexOf here, but this is nicer semantics.
        return this.indexOf(post);
    },
    
    getPromotedPosts: function() {
        return this.filter(function(post) {
            return post.isPromoted();
        });
    }
});

model.ChatList = Backbone.Collection.extend({
    "model":model.Chat,
    
    // Placeholder.
    // We might want this to be a moving window of a certain size, but
    // for now we'll just accumulate everything (e.g. leave this as a
    // default collection.)
});

model.ExpiringChatList = model.ChatList.extend({
    EXPIRATION_TIME: 10000,
    
    add: function(chat) {
        // every time we get an add, pass it up the chain but also
        // delay a removal of the item.
        model.ChatList.prototype.add.call(this, chat);
        
        var that = this;
        setTimeout(function() {
            that.remove(chat);
        }, this.EXPIRATION_TIME);
    }
});

model.Event = Backbone.Model.extend({
    initialize: function(args) {
        Backbone.Model.prototype.initialize.call(this, args);
        
        // These tests handle a situation where a client Event is inflated 
        // based on server data that has simple arrays in posts/chat fields
        // because Collections get JSON'd down to arrays. annoying, but this
        // will replace them with empty lists. If we end up with some fancier
        // serialization strategy later, will need to replace this.
        if(!(this.get("posts") instanceof model.PostList)) 
            this.set({"posts":this.defaults()["posts"]});
        if(!(this.get("chat") instanceof model.ChatList))
            this.set({"chat":this.defaults()["chat"]});
    },
    
    defaults: function() {
        return {
            title: "Default Event Title",
            posts: new model.PostList(),
            chat: new model.ChatList(),
            start: new Date().getTime(),
            
            // sets the scaling factor for votes; how many points a post gets per
            // vote/(second of age). If this was 1, then votes one second apart
            // would be twice as valuable. Some value in the 10^-6 range
            // should be okay (we used 10^-4 in the orig version, but we
            // were using seconds not ms, so added in extra 0s)
            voteTimeScoreFactor: 0.000001
        }
    },
    
    addChat: function(newChat) {
        this.get("chat").add(newChat);
    },
    
    addPost: function(newPost) {
        this.get("posts").add(newPost);
    },
});

})()