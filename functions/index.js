// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');

// The Firebase Admin SDK to access the Firebase Realtime Database. 
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

const moment = require('moment');

const dateFormat = "YYYY/MM/DD HH:mm";
const dateFormatUser = "DD/MM/YYYY HH:mm";
const dateFormatOnlyDay = "dddd";
const flexibleHourDiff = 2;


/*
Sends notification to user which reservation that he published was picked
*/
exports.notifyOnPickedReservation = functions.database.ref('/users/{uid}/pickedReservations/{pushId}')
    .onCreate(event => {
        const reservation = event.data.val();
        const userId = reservation.uid;
        const restaurant = reservation.restaurant;

        const title = "Your reservation to " + restaurant + " has been picked";
        const body = "You earned 2 stars!";
   
        return sendNotification(userId, createPayload(title, body, {}))
            	.then(results => {
                    console.log("notifyOnPickedReservation successfully finished");
                })
                .catch(error => {
                    console.log("notifyOnPickedReservation finished with error:", error);
                });
    });


/*
Spam handle Sends notification to user which was reported spammer
*/
exports.notifyOnReportedSpammer = functions.database.ref('/users/{uid}/spamReports')
    .onWrite(event => {
        const userId = event.params.uid;
        const numOfReports = event.data.val();
        const title = "Your reservation was reported as spam" ;
        let body;

		switch (numOfReports) {
		    case 1:
		        body = "warning: next time your stars will be lost";
		        break;
		    case 2:
		        body = "warning: next time you will be blocked";
		        admin.database().ref('/users/' + userId + '/stars').set(0);
		        admin.database().ref("/users/" + userId + "/starRemoveDate").set(null);
		        break;
		    case 3:
		        body = "You are blocked from our app";
				admin.auth().updateUser(userId,{
			  		disabled: true
				})
		        break;
		}
   
        return sendNotification(userId, createPayload(title, body, {}))
            	.then(results => {
                    console.log("notifyOnReportedSpammer successfully finished");
                })
                .catch(error => {
                    console.log("notifyOnReportedSpammer finished with error:", error);
                });
    });



/*
When a new reservation is published-
sends notification to user if there is a match
*/
exports.notifyOnNewMatch = functions.database.ref('/reservations/{pushId}')
    .onCreate(event => {
        const reservation = event.data.val();
		const notificationsPromises = [];
       	const title = "New reservation matching your request was arrived";

        return admin.database().ref('/notificationRequests')
    			.orderByChild('numOfPeople')
    			.equalTo(reservation.numOfPeople)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(notificationReqSnap => {
  						notificationsPromises.push(matchedNotification(reservation, event.params.pushId, notificationReqSnap.val(), title));
					});
					return Promise.all(notificationsPromises)
				})
				.then(results => {
                    console.log("notifyOnNewMatch successfully finished");
                })
                .catch(error => {
                    console.log("notifyOnNewMatch finished with error:", error);
                });

    });


/*
When a new notification request is published-
sends notification to user if there is a match
*/
exports.notifyOnExistsMatch = functions.database.ref('/notificationRequests/{pushId}')
    .onCreate(event => {

        const notificationReq = event.data.val();
		const notificationsPromises = [];
       	const title = "Reservation matching your request is exists";

        return admin.database().ref('/reservations')
    			.orderByChild('numOfPeople')
    			.equalTo(notificationReq.numOfPeople)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(reservationSnap => {
  						notificationsPromises.push(matchedNotification(reservationSnap.val(), reservationSnap.key, notificationReq, title));
					});
					return Promise.all(notificationsPromises)
				})
				.then(results => {
                    console.log("notifyOnExistsMatch successfully finished");
                })
                .catch(error => {
                    console.log("notifyOnExistsMatch finished with error:", error);
                });

    });


/*
If no one picked a reservation (the date field is 2 hours or less from current time),
sends a notification and move it to history
Running every 15 minutes
*/
exports.notifyAndMoveToHistoryReservationsCron = functions.https.onRequest((req,res) => {
	const latestDateToNotify = moment().add(4,'hours').format(dateFormat); //2 hours difference between server to local time
	const notificationPromises = [];
	
	return admin.database().ref('/reservations')
    			.orderByChild('date')
    			.endAt(latestDateToNotify)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(reservationSnap => {
    					const reservation = reservationSnap.val();

            			const title = "Your reservation to " + reservation.restaurant + " wasn't picked";
        				const body = "Don't forget to notify the restaurant you will not arrive";

  						notificationPromises.push(sendNotification(reservation.uid, createPayload(title, body, {})));
					});
					console.log("Send notifications...");
					return Promise.all(notificationPromises)
				})
				.then(results => {
					return moveOldItemsToHistory('/reservations', '/historyReservations', latestDateToNotify);
                })
				.then(results => {
					res.send('OK');
                    console.log("notifyAndMoveToHistoryCron successfully finished");
                })
                .catch(error => {
                	res.send(error);
                    console.log("notifyAndMoveToHistoryCron finished with error:", error);
                });
});



/*
Move to history notification requests
Running once a day
*/
exports.moveNotificationRequestsToHistoryCron = functions.https.onRequest((req,res) => {

	const latestDateToMove = moment().add(2,'hours').subtract(flexibleHourDiff,'hours').format(dateFormat); //2 hours difference between server to local time
	const promises = [];
	console.log("Moving to history notification requests before: ", latestDateToMove);

	return moveOldItemsToHistory('/notificationRequests', 'historyNotificationRequests', latestDateToMove)
				.then(results => {
					res.send('OK');
                    console.log("moveNotificationRequestsToHistoryCron successfully finished");
                })
                .catch(error => {
                	res.send(error);
                    console.log("moveNotificationRequestsToHistoryCron finished with error:", error);
                });
});



/*
If latestDateToRemove < current time => decrease num of stars and update latestDateToRemove to month later (if there are more stars)
*/
exports.removeStarsCron = functions.https.onRequest((req,res) => {

	const latestDateToRemove = moment().add(2,'hours').format(dateFormat); //2 hours difference between server to local time
	const promises = [];

	return admin.database().ref('/users')
    			.orderByChild('starRemoveDate')
    			.endAt(latestDateToRemove)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(userSnap => {
  						const user = userSnap.val();
  						const numOfStars = user.stars;
  						const userId = userSnap.key;
  						if(numOfStars > 0){
  							if(numOfStars == 1){
								promises.push(admin.database().ref('/users/' + userId + '/starRemoveDate').set(null));
  							}
  							else{
  								const updatedRemoveStarDate = moment(user.starRemoveDate, dateFormat).add(1,'months').format(dateFormat);
  								promises.push(admin.database().ref('/users/' + userId + '/starRemoveDate').set(updatedRemoveStarDate));
  							}
  							promises.push(admin.database().ref('/users/' + userId + '/stars').set(numOfStars-1));
  						}
  					});
  					console.log("Num of users that lost a star: ", promises.length/2);
					return Promise.all(promises);
				})
				.then(results => {
					res.send('OK');
                    console.log("removeStarsCron successfully finished");
                })
                .catch(error => {
                	res.send(error);
                    console.log("removeStarsCron finished with error:", error);
                });
});


/*
Updates statistics about last day reservations.
*/
exports.statisticsCron = functions.https.onRequest((req,res) => {

	const yesterday = moment().add(2,'hours').subtract(1,'days');
	const startOfDayYesterday = yesterday.startOf('day').format(dateFormat); //2 hours difference between server to local time
	const endOfDayYesterday = yesterday.endOf('day').format(dateFormat);
	const dayYesterday = yesterday.format(dateFormatOnlyDay).toUpperCase();

	console.log("startOfDayYesterday: " + startOfDayYesterday);
	console.log("endOfDayYesterday: " + endOfDayYesterday);
	console.log("dayYesterday: " + dayYesterday);

	const increaseResCountPromises = [];
	const countRes = {};

	return admin.database().ref('/historyReservations')
    			.orderByChild('date')
    			.startAt(startOfDayYesterday)
    			.endAt(endOfDayYesterday)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(reservationSnap => {
  						const reservation = reservationSnap.val();
  						if(reservation.isSpam == false){
  							console.log("Adding to statistics reservationId:" + reservationSnap.key);
  							const placeId = reservation.placeId;
  							const day = reservation.day;
  							const timeOfDay = reservation.timeOfDay;

  							if (typeof countRes[placeId] === "undefined"){
  								countRes[placeId] = {};
  							}
  							if (typeof countRes[placeId][day] === "undefined"){
  								countRes[placeId][day] = {};
  							}

  							if (typeof countRes[placeId][day][timeOfDay] === "undefined"){
  								countRes[placeId][day][timeOfDay] = 1;
  							} else{
  								countRes[placeId][day][timeOfDay] = countRes[placeId][day][timeOfDay] + 1;
  							}
  						}
  					});

  					console.log(countRes);

  					Object.keys(countRes).forEach(placeId => {
  						Object.keys(countRes[placeId]).forEach(day => {
  							Object.keys(countRes[placeId][day]).forEach(timeOfDay => {
  								increaseResCountPromises.push(increaseResCount(placeId, day, timeOfDay, countRes[placeId][day][timeOfDay]));
  							});
  						});
  					});

  					return Promise.all(increaseResCountPromises);
  				})
  				.then(results => {
  					return increaseDayCount(dayYesterday);
                })
				.then(results => {
					res.send('OK');
                    console.log("statisticsCron successfully finished");
                })
                .catch(error => {
                	res.send(error);
                    console.log("statisticsCron finished with error:", error);
                });

});




/*
Sends notifications to users with stars upon arrival of hot reservations
*/
exports.notifyHotReservations = functions.database.ref('/reservations/{pushId}')
    .onCreate(event => {

    	const minHotnessNotification = 7;
		const maxWarmResHotness = 7;
		const maxHotResHotness = 8;

        const reservation = event.data.val();
        if (reservation.hotness >= minHotnessNotification){

        	let title = "Boiling-hot reservation was arrived!";
        	if(maxWarmResHotness < reservation.hotness  && reservation.hotness <= maxHotResHotness){
        		title = "Hot reservation was arrived!";
        	}
        	if(reservation.hotness <= maxWarmResHotness){
        		title = "Warm reservation was arrived!";
        	}
        	
        	const dateUser = moment(reservation.date, dateFormat).format(dateFormatUser);
       		const body = "Reservation to " + reservation.restaurant + " at " + dateUser;
       		const data = {
            	reservationId: event.params.pushId
        	};
        	const payload = createPayload(title, body, data);
        	payload['notification']['click_action'] = ".com.reserveat.reserveat.MatchedReservationActivity"
        	
        	const notificationPromises = [];

        	return admin.database().ref('/users')
    			.orderByChild('stars')
    			.startAt(1)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(userSnap => {
  						const user = userSnap.val();
  						const userId = userSnap.key;
  						if(reservation.uid != userId){
  							if(user.stars == 3){
  								notificationPromises.push(sendNotification(userId, payload));
  							}else if(user.stars == 2 && reservation.hotness <= maxHotResHotness){
								notificationPromises.push(sendNotification(userId, payload));
  							}else if(reservation.hotness <= maxWarmResHotness){//1 star
								notificationPromises.push(sendNotification(userId, payload));
  							}
  						}
  					});
					return Promise.all(notificationPromises);
				})
				.then(results => {
                    console.log("notifyHotReservations Successfully finished");
                })
                .catch(error => {
                    console.log("notifyHotReservations finished with error:", error);
                });
        }
        return Promise.resolve();
    });


const increaseDayCount = (day) => {

	return admin.database().ref('/statistics/totalNumOfDays/' + day)
    			.once('value')
    			.then(snapshot => {
    				let dayCount = 0;
    				if(snapshot.exists()){
    					dayCount = snapshot.val();
    				}
  					return snapshot.ref.set(dayCount + 1);
    		})
};


const increaseResCount = (placeId, day, timeOfDay, dayCount) => {

	return admin.database().ref('/statistics/' + placeId + '/' + day + '/' + timeOfDay)
    			.once('value')
    			.then(snapshot => {
    				let reservationCount = 0;
    				if(snapshot.exists()){
    					reservationCount = snapshot.val();
    				}
  					return snapshot.ref.set(reservationCount + dayCount);
    		})
};


const matchedNotification = (reservation, reservationKey, notificationReq, titleStr) => {

   	let dateMatch = reservation.date == notificationReq.date || notificationReq.date == "";
  	if(notificationReq.isFlexible && !dateMatch) {
		const dateReservation = moment(reservation.date, dateFormat);
		const minDateStr = dateReservation.clone().subtract(flexibleHourDiff,'hours').format(dateFormat);
		const maxDateStr = dateReservation.clone().add(flexibleHourDiff,'hours').format(dateFormat);
  		dateMatch = notificationReq.date > minDateStr && notificationReq.date < maxDateStr;
  	}

  	const myReservation = reservation.uid == notificationReq.uid;
  	const restaurantMatch = reservation.restaurant == notificationReq.restaurant || notificationReq.restaurant == "";
  	const branchMatch = reservation.branch == notificationReq.branch || notificationReq.branch == "";
  	const result = dateMatch && restaurantMatch && branchMatch && notificationReq.isActive && !myReservation;
  	if(result){
  		console.log("found a match , notification request of userId: " + notificationReq.uid);
  		const title = titleStr;
  		const dateUser = moment(reservation.date, dateFormat).format(dateFormatUser);
   		const body = "Reservation to " + reservation.restaurant + " at " + dateUser;
    	const data = {
    		reservationId: reservationKey
    	};
    	const payload = createPayload(title, body, data);
    	payload['notification']['click_action'] = ".com.reserveat.reserveat.MatchedReservationActivity"
  		return sendNotification(notificationReq.uid, payload);
  	}
  	return Promise.resolve();
};


const moveOldItemsToHistory = (refToRemove, refToAdd, latestDateToMove) => {

	const promises = [];

	return admin.database().ref(refToRemove)
    			.orderByChild('date')
    			.endAt(latestDateToMove)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(itemSnap => {
    					const item = itemSnap.val();
    					if(item.date != ""){
    						const key = itemSnap.key;
  							promises.push(admin.database().ref(refToRemove + '/' + key).set(null));
  							promises.push(admin.database().ref(refToAdd + '/' + key).set(item));
    					}
  					});
  					console.log("Num of items moving to history: ", promises.length/2);
					return Promise.all(promises);
				})	
};


const sendNotification = (userId, payload) => {

	return admin.database().ref(`/users/${userId}/instanceId`)
        		.once('value')
        		.then(result => {
            		const instanceId = result.val();
            		console.log("Sending notification...");
            		return admin.messaging().sendToDevice(instanceId, payload);
            	})
};


const createPayload = (titleStr, bodyStr, dataObj) => {

	const payload = {};
	payload['notification'] = {
		title: titleStr,
		body: bodyStr
	}
	payload['data'] = dataObj;
	return payload;
};



