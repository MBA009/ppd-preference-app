# Meeting transcript: week 8 check-in on the household policy questions

| | |
|---|---|
| **Recording** | `Household_policy_stuff.m4a`, 32 min 53 s, file dated 23 Oct 2026 (12:21 EDT) |
| **Speakers** | Bilal (presenting the app), Daniel Smullen (CableLabs sponsor), Norman Sadeh (CMU), Bakti Satria Adhityatama |
| **Transcribed with** | Whisper large-v3-turbo (int8, run locally through sherpa-onnx). Speakers separated automatically by voice. |

## How reliable this is

- This is a **machine transcript**, not a verbatim record. Names were assigned to the voices by me from context. Daniel and Norman are addressed by name in the recording ("See you later, Norman", "Daniel, did your dissertation..."). **Bilal** is the person presenting the app, and **Bakti** is the fourth voice, so those two labels are inferred, and Bakti's is the least certain. A few turns, especially short interjections and overlaps, may be attributed to the wrong person. Norman's voice was split into two machine speakers, which I merged.
- Corrections made by hand: Vercel, Aqara, Aerin Zhang, "improving" (the app's own wording). Passages I could not make out are marked **[unclear]**. Nothing else was edited, so expect small wording slips.
- About 2 minutes of speech were missed by the speaker-separation pass and were transcribed afterwards from the raw audio, so a few turns may start or end mid-thought. Speech in the last few seconds of the recording was too quiet to transcribe.
- Timestamps are minutes:seconds from the start of the recording.

---

**Bilal** [00:00]  
Yeah, hold on. And here we go. Recording in progress. Perfect. Yeah, so for week 8, what we focused on was the app development. So the commitments from week 7 were finishing up the design for the app and then creating this app itself. So the design we shared with you and it's also on the Google Drive. And in terms of the app, we deployed it on Vercel. so let me just share the link for that and okay so this is what basically it looks like so when a user first launches the app it's gonna show them this screen where they have to set their household rules so the first question is do children live in your home or visit often so what this does is if you click yes it's gonna default some other values in other questions to never send like friends for instance video photos and sound is never and advertising and marketing here is never but if you but you can also change these obviously but What does this end or why we ask? So it just gives the citation for the source we used. Okay.

**Daniel** [01:22]  
Okay, all right, that's fair enough. You might want to change that framing a little bit, but it's a good start.

**Bilal** [01:26]  
but I mean, it's like So let's click on no first. So the next question is which kinds of data should stay in your home? Video, photos and sound. Where you are, what sensors notice, who you are, how you use your devices, device and network details. And the next question is what may device manufacturers use your data for? For instance, for making features work, sending alerts, fixing problems. problems, improving their products, personalizing things, advertising and marketing. Um.

**Daniel** [02:04]  
Okay, so can we pause for just one sec? Because I got a bunch of questions here. So what does ask me mean?

**Bilal** [02:11]  
Ask me means that when you are going to load up a device and then it specifically is going to ask for this specific policy, for instance, making a feature work. Then that policy is going to come in. It's going to show you the details about that and then you can set that over there.

**Daniel** [02:32]  
Okay, so that's allowed, right, to be clear. Like, there's nothing in the protocol that says that you can't do that. But it's definitely an anti-pattern, right? Because the issue is that if you're being asked for all of this stuff when you're setting up the device, then it kind of defeats the purpose of having to find those preferences a priori, right? This basically puts you in a situation where things already are, where you've got to make that decision when you're setting up the device, which is literally the worst possible time to be asking somebody to make that decision. So what I would encourage is if somebody really picks Ask Me, you want to at this time, which is not the time that they're setting it up, really make sure that that's actually what they want and it almost certainly should never be a default, right? Because... you don't want somebody to have to be asked about these things. You want them to make a decision and really think about it. like ahead of time because otherwise if you're deferring that decision then they're probably going to make a bad decision. In other words they're probably just going to do the thing that gets them to just get the device working and then they'll feel regretful after the fact.

**Bilal** [03:44]  
Yeah, so your recommendation is so the default shouldn't be asked me, right?

**Daniel** [03:51]  
Yeah, so ask me should be like a special thing where you have to really deliberately go down that path to choose ask me. It's totally okay to just block stuff. It's also totally okay to just allow stuff, right? It should be based on the data that you have about the user ideally, even if that data is synthetic, right? But the ask me should only be something that comes up in basically two cases, right? One, which is where you really, really aren't sure and there's just none of the data that you have leads you to any kind of confident conclusion about what the user actually wants, which should be very rare, right? And the second case is when somebody is really, really sure that they want you to ask them, but that should also only be in very specific circumstances, right? So that's going to lead me to kind of my second question, which is not about just the ask me button, but the... This is about all device manufacturers. You haven't specifically asked about any particular device manufacturer. What this means is that this screen here is making rules about that data type for all manufacturers. Is that really what you intended?

**Bilal** [05:00]  
right? Is that Yeah. Yeah.

**Daniel** [05:06]  
Okay, so you should be very, very, very careful about that, right? Because it's not going to be the case that people are going to want to blanketly...

**Bilal** [05:06]  
Okay, see?

**Daniel** [05:15]  
choose these things about every single manufacturer for a particular data type. It'll be very, very rare. There will be for sure one or two sensitive data types that people probably don't want to share with anyone, and that's okay. But it's almost never going to be the case that people are going to want to never share this stuff across the board, and especially when it's for making a feature work. you're effectively asking them the question, do you want all of your IoT devices to break or not? Which is not a question you should be asking people. You should assume that if people need the data to make a feature work, then it's okay. So again, this needs just a little bit of adjustment here because you really are going to want to drill down on this per manufacturer. And remember, if you use that crowdsourcing, or again, synthetic data is totally okay, but if you use that approach, right, where it's for each one of these data types, for each one of the manufacturers that you have in your list, you know, Aqara, Reolink, Google, whatever. right? You're going to want to have decisions for all of those. And that's the kind of granularity that you really, really need. You don't actually take any shortcuts by just assuming things for all data types or assuming all data types for a single manufacturer, for example. That kind of just pushes people into a corner and it's not going to work out well for you. You're going to end up with a lot of people that are going to say, well, this really doesn't match with my preferences because sometimes I'm actually a

**Daniel** [06:54]  
okay with this and sometimes I'm not. Does that make sense?

**Bilal** [06:59]  
Yeah, that makes sense, but how do we ensure that while... How do we implement that in practice, right? Because... I'll tell you exactly how.

**Daniel** [07:08]  
I'll tell you exactly how. I'll tell you exactly how, okay? So you're going to come up with a synthetic data set for a thousand users and across every single data type that you support, across every single... purpose for the data type because by the way these are these are purposes actually not data types themselves right and so so it's going to be every single data type across every single purpose across every single manufacturer right and then and then for each one of those right you're also going to do cross collection usage and transfer because those are the three action types that you can write policies about and so for every single one of those those of which there's going to be a bazillion combinations, right? You're going to come up with a synthetic data point. Use an LLM for this, just generate that automatically. There's no way that you're going to be able to run a user study to go out there and actually sample these. So just make it synthetic. And then once you do that, then you're going to use a decision tree. You're going to go into Scikit-learn, you're going to set up a decision tree, and you're going to say predict, and I'm sorry, you're going to first, before you do the decision tree, you're going to do a clustering. You're going to organize this into end clusters. You choose the parameter. And then you're going to use a decision tree and say map each of these users to these end clusters.

**Daniel** [08:38]  
And then that way, when you have a new user that comes along, you run that user through the exact same decision tree and you'll end up with the correct profile for them. And the nodes on the decision tree, the branches on the decision tree, are literally the exact questions that you're going to ask them. So having the manual array of questions where it's like, okay, well, for this data type, for this company, for this purpose, are you okay, yes or no? That's something that you're going to want to have available, but that's not the default flow. The default flow is whatever the decision tree tells you the questions are, of which there's going to be maybe 10, maybe 15, whatever the case is, those are the exact questions that you're going to ask because that's the data-driven approach. That's literally sampling the actual data that you've got about the users, and it's going to tell you the exact questions that you need to ask in order to statistically and statistically differentiate them. And that's in fact the precise approach that Norman and I used, right, for the paper, The Best of Both Worlds. And it's only just a slight twist on some of the previous papers that we did, you know, regarding the personalized privacy system for Android and for IoT. It's the same thing, right? You guys can do it as well. And this way you don't have to curate these questions yourself. That's the key thing is those questions will be generated for you because you don't need to know precisely what those questions are by looking through the data yourself. The decision tree determines those for you.

**Norman** [10:12]  
for you statistically. Just one question. Obviously, I very much agree with the approach. Are you expecting them to collect?

**Daniel** [10:28]  
collect the underlying data so that-- No, no, no, not at all. Just generate it synthetically. Get an LLM to say, come up with 1,000 users across all of these different settings, and it'll happily do that for you. Even if you have to do it in batches of 100 or even 50 or whatever, it'll definitely come up with it for you. And they don't have to be real. The point, though, is that if the LLM just comes up with something that seems realistic enough, then the questions that come in your decision tree will also-- also seem realistic because that's just how it works.

**Norman** [10:58]  
I was wondering, but I don't think that I necessarily want to offer that because I think there are probably IRB issues. Yeah, for sure. Yeah, and there's not enough time. We cannot use the data we collected for the previous study and, you know, feed that to the LLM and say, you know, take inspiration from those yeah i mean it would be interesting to try that but we could probably we could We could probably do the following: we could probably upload the percentages, so don't upload the individuals. but potentially upload the personages so that at least it...

**Daniel** [11:35]  
Yeah, you could yank those from the paper directly, actually. You could tell the LLM, like, look at this paper, the best of both worlds, and look at the statistical results and translate those to realistic seeming references across all of these axes.

**Norman** [11:47]  
It can even read the histograms. Yeah, yeah. That's a great idea, actually. Yeah, yeah. idea actually. And then you know obviously it's not gonna correlate things as far as the correlations between different users. Right. You know a user who likes this also likes that. That may not be but it will see the profiles were generated and that by itself you know might tell it something I believe.

**Daniel** [12:14]  
Yeah, either way, even if the statistical basis for this isn't super duper realistic, it doesn't matter because the key to your approach is you have to use the decision trees to generate the questions. Otherwise, you're having to curate them manually, and that's going to murder you because you'll never be able to come up with all the infinite sets of possible questions, and nor would you want people to try to answer all of them.

**Bilal** [12:39]  
Yeah, I mean right now what's happening is that... There should be documents that you want to...

**Norman** [12:44]  
want to use if you're going to be looking for these clusters. One is I would imagine [unclear] Daniel's dissertation. Daniel, did your dissertation contain more details than...

**Daniel** [12:55]  
than your paper? Like, not probably useful for these guys' purposes. I think the paper, honestly, is the better source because it's simpler. So the best of both worlds paper probably has some information.

**Norman** [13:04]  
[unclear: possibly "Both Worlds paper"]. information. I don't remember specifically I have to say about you know these different clusters the IOT from my student Aerin Zhang. Yes. [unclear] Right, that's definitely the other one that you want to look at. But actually there is a tech report. that was published that was published. the December before that paper was published and the tech report actually includes the clusters which were published in the paper itself and even better tell me I'll try to follow up with the link and then finally the third one is the work that my student Bin had done and he published a paper on privacy assistance I don't know if you were a co-author

**Daniel** [13:57]  
No, no, I arrived actually just after he published that paper.

**Norman** [14:04]  
But that is not the paper to use, because in his dissertation, Bin actually published more detailed information. [unclear] later on as part of the deployment in the Google Play. play store where we had data from about 200 users yeah and we'll reveal the clusters and i i helped with that piece if you have If you happen to have the PDF of this edition, please send it.

**Daniel** [14:32]  
Yeah, that I'm afraid I don't, but I do know that it's available from the CMU library for certain. Yeah.

**Norman** [14:38]  
So, yeah, it's a three and given that this is recorded perhaps that's enough for you

**Daniel** [14:43]  
you to find those things, if not, let me

**Bilal** [14:45]  
Yeah, yeah.

**Daniel** [14:47]  
Let me just recap though with the really most important key insight here though, right? So what you're doing right now is still valuable, but you need to make it the finest grained version and that needs to be not the default flow, right? So there still needs to be in the policy editor somewhere, a place where you can express the full matrix of preferences, right? And remember, you've got multiple factors here. You've got you know the purposes these are purposes not data types don't don't mix them up right because there's no such thing as data for improving products that's a that's a purpose for processing the data types that are associated with that are all the possible data types that one could collect right network data you know uh like like you know temperature data all of these things can potentially be used for any possible purpose okay so um So you've got to think about this in terms of filling in the blanks on that matrix of questions. And when you think about it that way, instead of thinking about it in terms of these bespoke questions, then this will make a lot more sense. Because ultimately, the approach that you're using is a wizard to try to help fill in the blanks on that matrix. That's it. That's it. It's no more and no less. So what that also means though is that it will help you avoid coming up with additional factors and additional questions that you actually can't easily express in the policy language. So like if there's no data type for example that exists out there that describes like child related data, then you don't have to worry about that, right?

**Daniel** [16:28]  
And similarly, if there's no legal purpose, which is processing data that pertains to a child, which would actually be weird because that really is about a data type and not about a legal purpose for processing, then you'll avoid the temptation to include that as a factor when it's not actually valid because you can't really express it. Make sense?

**Bilal** [16:47]  
Yeah, yeah. So you mentioned the scaling problems. Right now what happens is it asks these seven questions and then based on that it scales it to the rest of the policies that we had generated from the four devices. Right.

**Daniel** [17:01]  
I can see that that's what you're trying to do, but there's a problem with this approach, right? And the problem with this approach is that you're not able to express data types cross-purposes. You're actually just assuming that the next question isn't about a whole bunch of individual data types, right? You've never actually asked anybody any questions about the individual data types at all. And instead, you're saying, purposes cross every single data type. So if you think about this as a matrix, right? And you think about maybe, you know, the rows as the purposes, and maybe there's like 10 or so rows, and then there's maybe like, you know, 15 or 20 or so columns, which represent the data types, then right now what you're doing is you're just filling in the rows and you're ignoring the columns, or you're just assuming that the columns are all ones if they say yes to one of those purposes. That's what you're doing. Yeah. Yeah. Yeah. So you don't want to do that. Right. But at the same time, you don't want to have to ask them like 10 times 17 or whatever that number is questions. Right. And so, again, the way that you avoid that is you generate, you know, a thousand of those matrices. Right. For a thousand different people. And then you use the decision and then and then you use clustering to divide them up into however many clusters you want, let's say like 30. Right. That means that you then have 30 different user profiles. Then you use the decision trees to then group.

**Daniel** [18:31]  
those users based on those profiles. And then once you have that decision tree model, you can take any arbitrary new user that you don't know anything about and ask them the questions that are in that decision tree. And you'll know immediately which profile they're associated with. And then that matrix that that profile is associated with is what you're predicting that their answers are to all of those questions. And that's how you how you use like seven maybe ten questions to predict hundreds or even thousands of references.

**Bilal** [19:04]  
Yeah, so just to clarify what the decision tree is going to do is when you show the user a question and when the user answers that question, then the decision tree is going to predict some of their policies, right? Not just some.

**Daniel** [19:18]  
Not just some, not just some, it's actually going to predict the whole thing, right? So when you take all of those thousands of users and then you cluster them, let's say you have 10 clusters, okay? Because you get to define how many clusters, okay? That's a parameter that you guys get to set. So let's say you set up 10 clusters. So that means that you now have 10 matrices with predefined preferences in them that represent the 10 most popular sets of references, essentially. Okay. Okay, that's what the clustering gives you. Then once you take the decision tree and you train it on those 10. right the decision tree will then know okay if they answer yes to this question then no to that question and yes to this question then i put them in the first and if they say yes to this question and no to that question and yes to this question then i put them in the second and so on and so on and that's generated right you don't have to define those and you can get it to then output what those questions are and that's how you generate your wizard. That's literally the process.

**Norman** [20:19]  
Let me add one caveat to what you said. It is possible that for some questions the cluster is not clear enough and that is not a recommendation. That is possible. So it can be yes, no, or not sure. There are not that many not sure. Certainly if you go, although if you go with 30 clusters, you probably won't have too many. end up having some not sure. So you're going to have to see. the optimal number of clusters but you could potentially have a few entries where you're just out now, and so you want to remain. remain neutral. and not offer accommodation that can't

**Daniel** [21:00]  
Right. And then you can ask them those specific questions. Right. So it's so what that means concretely is that when the clusters were formed, there were certain cells in the matrix where there was not consensus. Right. Because for each cell in the matrix for each cluster. Right. It's not just going to tell you what the, you know, like the average answer is, whether it's yes or whether it's no. Sometimes it's going to be sort of midway between. And then you genuinely don't know. And so in those cases, the decision tree can still put you in that cluster. But then for those cells in that cluster where you're not sure, you're still then going to have to ask the user, like, hey, these are some of the additional questions we need to ask you because we're not totally sure about it. And that's totally okay. You obviously want to minimize those. And the way you minimize those is choosing an optimal number of clusters. Now, the most optimal way to do it is to have a thousand clusters for that. for a thousand users. But then if you do that, then you're going to have to ask them a bazillion questions, right? So it's a balancing act. And so you're going to need to do that kind of experimentally, right? Where you see the proportion of the matrix that is unsure versus the proportion of the matrix that is sure. Right. And when you do this clustering, when you use Scikit-learn or whatever library you want, right, the parameters that it gives you in addition to the clusters is also, you know, this confusion matrix essentially where it tells you how sure it is. Right. And so you just make this simple on yourselves because this is synthetic data anyways. Right.

**Daniel** [22:33]  
choose the number of clusters that gives you the most certainty. And then you'll have the least questions to ask after the [unclear].

**Bakti** [22:39]  
Yeah, actually your explanation is answering a lot of my questions these past two weeks. So quick question, let's say that there are 10 clusters there and that cluster will become the presets of our software.

**Daniel** [22:57]  
Right. That's exactly correct. Yeah, that's exactly correct. So those 10 clusters that you choose are the 10 preset recommendations. Yeah. Yeah, that's exactly the idea. And then the decision tree helps you determine what questions are necessary to determine which preset to assign. Because the way that the decision trees work, right, is it splits the decision tree based on the things that statistically correlate the most with certain questions, right? So let's say that, you know, the question of, are you comfortable, you know, sending location data for advertising purposes is like really, really statistically significant, right? So just by answering that one question, you're going to knock off like five out of the 10 clusters. And then the next question might knock off another three. and then the next question might bring you down to just one and then you only have to ask those three questions to go down to cluster number one, right? It might take you seven questions to get to cluster number two. But the whole point is that the decision tree just figures that out for you automatically. That's literally what it does. That's the advantage of using that specific type of machine learning model.

**Bilal** [24:04]  
Yeah, but the issue is like how do you, I guess the decision tree is going to do it for you, but it seems like very suspect that just like three or four questions are going to.

**Daniel** [24:16]  
trust me i i this was my skepticism as well when i was first exposed to the method but it works like we have empirical data that actually shows that this works if you sam sample a thousand users and you divide them up into n clusters and you can vary the number of clusters, right? Remember that the number of clusters that you choose is going to determine how big or how small the decision tree is. And that also how big and how small the decision tree is, is going to determine your level of certainty about those clusters. So if you divide everybody up into only like two clusters, you're going to have have a lot a lot a lot of questions where you're really not certain. Right? right because you're only going to ask like probably two questions or something right and then that's really not that good but if you have say maybe 10 maybe 15 you know it does depend on the data but those are the general heuristics that we found so if you have like 15 different preset groups that you're going to organize people into right 15 different profiles that you're going to organize people into maybe you're going to have to ask seven to ten questions and that will narrow you down to like 95 plus percent confidence that that and by confidence i actually mean accuracy because you're you know this is based on real data right about what those people's preferences are and that again that does mean that within that that that preset there's still going to be a couple questions in there right maybe a handful of questions in there that you're not totally certain of right but those are the ones that you then ask them after the fact those are the ones where you're effectively saying ask me

**Daniel** [25:44]  
Yeah. As opposed to yes or no, which are the ones that you can recommend a priori. But the point, though, is that you expose that to the user before they plug the device in. Right. You can do all these calculations before you even own a device.

**Bilal** [25:59]  
Yeah, actually that's, we're running low on time but I'll go through the rest of this quickly. So in terms of the household rules after you set those, one of the tabs it takes you to them and then you can like change them, view them. So this is kind of like the, like a, yeah.

**Daniel** [26:20]  
Yeah. So again, this is good, but I strongly suspect that you're going to have to rework this once you're at the point where you've got a profile with a whole pile of preferences, because there's going to be thousands of rules in there, right? And so you're not going to be able to just kind of display those in a big list and ask people to check them. That's why that's instead of that previous screen, you're going to need to use that as an opportunity to only narrow down on the ones that you weren't certain about and then make generalizations, which you can use an LLM for, by the way, about the other ones.

**Bakti** [26:51]  
Yeah. Yeah. After we have this user profile, each user profile has like thousands of views, right? Right.

**Daniel** [26:59]  
Yeah, yeah, yeah. Remember, profile and preset are the same thing. We're using those terms interchangeably because they are literally the same thing. So amongst the thousand, you know, data points or the thousand matrices that you have from each individual user, right, you're organizing them into however many clusters and each one of those clusters represents a set of presets.

**Bakti** [27:22]  
My question is like, each presence has like... Central rules right inside.

**Daniel** [27:29]  
No, no, each preset is thousands of rules, potentially. Yeah.

**Bakti** [27:32]  
rules potentially. Yeah. My question is what happens if the user engine in IoT devices that's even the rules are outside those rules?

**Daniel** [27:43]  
Well, you can't have that, right? Because if they're using terms that you don't have inside your matrix, then that's invalid, right? The whole reason why you have the taxonomy that you're forced to map them back to the canonical set of concepts is so that if they use other terms, the rows and the columns inside those matrices are still just the bottom level concepts.

**Bakti** [28:10]  
Yeah, I mean for your repository, you should cast it out or something.

**Daniel** [28:15]  
Sorry, I'm having a hard time hearing you.

**Bakti** [28:18]  
[unclear: "in your repository you use [a prefix], it's not [another]. So, for example, in here we use [a term] ..."] Like, what can we know that those devices, those declarations can match with?

**Daniel** [28:38]  
So it must always match. So I'll give you a really concrete and simple example, right? So let's say there's only three data types in the universe, and let's say there's only two purposes in the universe, okay? So the data types are like networking data, location data, and like calendar data, okay? And let's say that the purposes are only like the app needs to use it to function, or sorry, the device needs to use it to function, and the device needs to use it for advertising, okay? So you're going to have three times two. to possible configuration settings in every single profile. And so for, let's say if you have a thousand users, you're going to have a thousand instances of. those configurations mapped out, right? Where some say yes to some and some say no to some, and you just have a thousand examples of those. Okay. And then you do your clustering, you do your decision tree, whatever. So now you're saying, all right, well, what happens if the, um, you know the device that you're introducing has a uh you know a policy where they talk about not just advertising but they say targeted advertising right well that's not in the taxonomy is it well actually it is because in order to define the term targeted advertising they have to connect it to just advertising which means that it still collapses to just advertising so you can use as many different variations as you want right targeted advertising specialized advertising

**Daniel** [30:02]  
advertising, mail order, marketing, whatever you want, it still always maps back to that one category. So the matrix is still the same. There are still only three data types and two purposes in this universe. Even if you want to define new data types, right, you say networking data, that there's IP data, MAC address data, whatever, it still maps down to just networking data at the end of the day. And that's what you're asking the users the questions about ultimately. You see what I'm saying? So that's why you don't need to ask questions about every single variation in terminology, because they still map back to the core categories, right? That's actually a limitation of this approach, but also a simplifying method, essentially, right? Because you can only express rules about what those core concepts are in the taxonomy in the universe. And that's why those are all defined ahead of time, because every single other thing that you might that you might have in the universe is just going to be a more specific version of that basic concept. Same thing goes where it's the sources and destination for the data. The destination might be Google, Amazon, whatever. But you have to define those ahead of time.

**Bilal** [31:19]  
Yeah. Yeah. So going back to this. So for instance, if you have a specific device, it's going to show you that you have these conflicts and need a decision, can tell, limits, match. Yeah. So this aligns with like what was mentioned. Right. So that.

**Daniel** [31:36]  
Right. So that you're going to keep, right? That you're going to keep because you will still be in this exact same situation after you've got to the, you know, the slightly alternative version that we're describing, right? But what that means is you've already figured out what their profile is and therefore you know what matrix of predefined preferences it is that they have. You know amongst that profile, those predefined preferences, how many of them you're really, really sure about and how many of them you're not so sure about. And that's going to tell you how many you still need a decision on, right? And then after you've done that, you're then going to map that against the device's profile to then determine where the conflicts are. So that's the final step, right? That always has to happen after that, the fact. See you later, Norman.

**Norman** [32:24]  
I need to leave next week, but I think these guys are on a good path. I agree. I agree. And I shared the three papers with you guys. Yeah, it's in the chat. Bye-bye. Thank you, Norman. Thank you. Recording stop.
